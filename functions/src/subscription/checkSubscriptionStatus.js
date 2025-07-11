// 📁 functions/subscription/checkSubscriptionStatus.js
// 메인 구독 상태 확인 함수 (Apple 공식 라이브러리)
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {Entitlement, SubscriptionStatus} = require("../shared/constant");
const {checkInternalTestAccount} = require("../utils/testAccounts");
const {checkAppStoreConnect} = require("./appStoreConnectService");
const {
  appstoreKeyId,
  appstoreIssuerId,
  appstorePrivateKey,
  appstoreBundleId,
} = require("../utils/appStoreServerClient");


const subCheckSubscriptionStatus = onCall({
  region: "asia-southeast1",
  secrets: [
    appstoreKeyId,
    appstoreIssuerId,
    appstorePrivateKey,
    appstoreBundleId,
  ],
}, async (request) => {
  try {
    console.log("🚀 [Apple Official Library] 통합 구독 상태 확인 시작");

    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "User must be authenticated",
      );
    }

    const userId = request.auth.uid;
    const email = request.auth.token?.email;

    console.log("🔍 구독 상태 확인 시작 (userId: " + userId +
      ", email: " + email + ")");

    // 🎯 Step 1: 내부 테스트 계정 확인 (최우선)
    const testAccountResult = checkInternalTestAccount(email);
    if (testAccountResult) {
      console.log(
        "🧪 내부 테스트 계정으로 구독 상태 반환: " +
        testAccountResult.entitlement,
      );
      return {
        success: true,
        subscription: testAccountResult,
        dataSource: "test-account",
        version: "v4-simplified",
      };
    }

    // 데이터 수집 변수
    let {originalTransactionId, appStoreFirst} = request.data;
    let subscriptionData = null;
    let dataSource = "unknown";

    // 🎯 Step 2: App Store Connect 우선 확인 (Apple 공식 라이브러리 사용)
    if (appStoreFirst) {
      try {
        console.log(
          "🚀 [Official Library] App Store Connect 우선 확인 시작 " +
          "(userId: " + userId + ")");

        // originalTransactionId가 없으면 Firestore에서 조회
        if (!originalTransactionId) {
          const db = admin.firestore();
          const userDoc = await db.collection("users").doc(userId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            originalTransactionId =
              userData?.subscription?.originalTransactionId ||
              userData?.originalTransactionId;
          }
        }

        // 🚀 Apple 공식 라이브러리로 App Store Connect API 호출
        if (originalTransactionId) {
          console.log("📡 [Official Library] App Store API 호출: " +
            originalTransactionId);

          const appStoreData = await checkAppStoreConnect(
            originalTransactionId,
          );

          // 🔍 App Store 데이터가 있고 무료가 아닌 경우 사용
          if (appStoreData && appStoreData.entitlement !== Entitlement.FREE) {
            subscriptionData = appStoreData;
            dataSource = "appstore-official-library";
            console.log(
              "✅ [Official Library] App Store Connect에서 구독 정보 발견: " +
              subscriptionData.entitlement,
            );
          } else {
            console.log("⚠️ [Official Library] " +
              "App Store Connect에서 활성 구독 없음");
          }
        } else {
          console.log("⚠️ [Official Library] originalTransactionId 없음");
        }
      } catch (error) {
        console.log("❌ [Official Library] App Store Connect 확인 실패: " +
          error.message);
        // 에러가 발생해도 계속 진행 (Firestore fallback)
      }
    }

    // 🎯 Step 3: App Store에 데이터가 없으면 Firebase에서 확인
    if (!subscriptionData) {
      try {
        console.log("🔍 [Firestore Fallback] Firebase 데이터 확인 시작");

        const db = admin.firestore();
        const userDoc = await db.collection("users").doc(userId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();

          // 🔥 웹훅이 저장한 subscription 필드에서 데이터 조회
          const subscription = userData.subscription;

          if (subscription && subscription.plan && subscription.status) {
            console.log("📦 [Firestore] 웹훅 구독 데이터 발견:", subscription);

            // 🎯 새로운 구조로 상태 결정
            let entitlement = Entitlement.FREE;
            let subscriptionStatus = SubscriptionStatus.ACTIVE;

            const now = Date.now();
            const expiryDate = subscription.expiryDate?.toMillis() || 0;
            const isActive = subscription.status === "active" &&
              expiryDate > now;
            const isExpired = expiryDate > 0 && expiryDate < now;

            // entitlement 결정
            if (isActive) {
              if (subscription.isFreeTrial) {
                entitlement = Entitlement.TRIAL;
              } else {
                entitlement = Entitlement.PREMIUM;
              }
            } else if (!isExpired && subscription.isFreeTrial) {
              entitlement = Entitlement.TRIAL;
            } else if (!isExpired && subscription.plan === "premium") {
              entitlement = Entitlement.PREMIUM;
            }

            // subscriptionStatus 결정
            if (subscription.status === "revoked") {
              subscriptionStatus = SubscriptionStatus.REFUNDED;
            } else if (isExpired) {
              subscriptionStatus = SubscriptionStatus.EXPIRED;
            } else if (!subscription.autoRenewStatus &&
              (isActive || entitlement !== Entitlement.FREE)) {
              subscriptionStatus = SubscriptionStatus.CANCELLING;
            } else if (!isActive && !isExpired) {
              subscriptionStatus = SubscriptionStatus.CANCELLED;
            }

            subscriptionData = {
              // 🎯 새로운 구조
              entitlement: entitlement,
              subscriptionStatus: subscriptionStatus,
              hasUsedTrial: subscription.isFreeTrial || false,

              // 메타데이터
              autoRenewEnabled: subscription.autoRenewStatus || false,
              subscriptionType: subscription.plan === "premium" ?
                "monthly" : "monthly", // 기본값
              expirationDate: subscription.expiryDate?.toMillis()
                ?.toString() || null,

              // 추가 정보
              hasEverUsedTrial: subscription.isFreeTrial || false,
              hasEverUsedPremium: subscription.plan === "premium" || false,
              originalTransactionId: subscription.originalTransactionId,
              lastNotificationType: subscription.lastNotificationType,
            };

            dataSource = "firestore-webhook";
            console.log("✅ [Firestore] 웹훅 데이터로 구독 정보 생성:", {
              entitlement: subscriptionData.entitlement,
              subscriptionStatus: subscriptionData.subscriptionStatus,
              hasUsedTrial: subscriptionData.hasUsedTrial,
            });
          } else {
            // 기존 레거시 필드에서 조회 (fallback)
            subscriptionData = {
              entitlement: userData.planStatus || Entitlement.FREE,
              subscriptionStatus: SubscriptionStatus.EXPIRED, // 레거시는 대부분 만료됨
              hasUsedTrial: userData.hasEverUsedTrial || false,
              autoRenewEnabled: userData.autoRenewStatus || false,
              expirationDate: userData.expirationDate,
              hasEverUsedTrial: userData.hasEverUsedTrial || false,
              hasEverUsedPremium: userData.hasEverUsedPremium || false,
            };
            dataSource = "firestore-legacy";
            console.log("📱 [Firestore] 레거시 Firebase 데이터 사용: " +
              subscriptionData.entitlement);
          }
        }
      } catch (error) {
        console.log("❌ [Firestore] Firebase 데이터 확인 실패: " +
          error.message);
      }
    }

    // 🎯 Step 4: 둘 다 없으면 기본값
    if (!subscriptionData) {
      subscriptionData = {
        entitlement: Entitlement.FREE,
        subscriptionStatus: SubscriptionStatus.ACTIVE, // 신규 사용자는 active
        hasUsedTrial: false,
        autoRenewEnabled: false,
        hasEverUsedTrial: false,
        hasEverUsedPremium: false,
      };
      dataSource = "default";
      console.log(
        "📝 [Default] 기본값으로 구독 정보 설정: " +
        subscriptionData.entitlement,
      );
    }

    console.log("✅ [Final] 구독 상태 확인 완료:", {
      entitlement: subscriptionData.entitlement,
      subscriptionStatus: subscriptionData.subscriptionStatus,
      hasUsedTrial: subscriptionData.hasUsedTrial,
      dataSource: dataSource,
      version: "v4-simplified",
    });

    return {
      success: true,
      subscription: subscriptionData,
      dataSource: dataSource,
      version: "v4-simplified",
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("❌ [Error] 구독 상태 확인 오류:", error);
    return {
      success: false,
      error: error.message,
      dataSource: "error",
      version: "v3-official-library",
      timestamp: new Date().toISOString(),
    };
  }
});

module.exports = {
  subCheckSubscriptionStatus,
};
