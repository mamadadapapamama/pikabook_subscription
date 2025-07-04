// 📁 functions/subscription/checkSubscriptionStatus.js - 메인 구독 상태 확인 함수
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {PlanStatus} = require("../shared/constants");
const {checkInternalTestAccount} = require("../utils/testAccounts");
const {checkAppStoreConnect} = require("./appStoreConnectService");
const {
  appstoreKeyId,
  appstoreIssuerId,
  appstorePrivateKey,
  appstoreBundleId,
} = require("../utils/jwt");

/**
 * 🔥 통합 구독 상태 확인 함수 (Firebase v2 with Secrets)
 */
const subCheckSubscriptionStatus = onCall({
  secrets: [
    appstoreKeyId,
    appstoreIssuerId,
    appstorePrivateKey,
    appstoreBundleId,
  ],
}, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "User must be authenticated",
      );
    }

    const userId = request.auth.uid;
    const email = request.auth.token?.email;

    console.log(`🔍 구독 상태 확인 시작 (userId: ${userId}, email: ${email})`);

    // 🎯 Step 1: 내부 테스트 계정 확인 (최우선)
    const testAccountResult = checkInternalTestAccount(email);
    if (testAccountResult) {
      console.log(
        `🧪 내부 테스트 계정으로 구독 상태 반환: ${testAccountResult.planStatus}`,
      );
      return {
        success: true,
        subscription: testAccountResult,
        version: "v2",
      };
    }

    // 기존 로직 계속...
    let {originalTransactionId, appStoreFirst} = request.data;
    let subscriptionData = null;
    let dataSource = "unknown";

    // 🎯 Step 2: App Store Connect 우선 확인 (appStoreFirst = true일 때)
    if (appStoreFirst) {
      try {
        console.log(`🔍 App Store Connect 우선 확인 시작 (userId: ${userId})`);

        // originalTransactionId가 없으면 Firestore에서 조회
        if (!originalTransactionId) {
          const db = admin.firestore();
          const userDoc = await db.collection("users").doc(userId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            originalTransactionId =
              userData?.subscription?.originalTransactionId;
          }
        }

        // App Store Connect API 호출
        if (originalTransactionId) {
          const appStoreData = await checkAppStoreConnect(
            originalTransactionId,
          );
          if (appStoreData && appStoreData.planStatus !== PlanStatus.FREE) {
            subscriptionData = appStoreData;
            dataSource = "appstore";
            console.log(
              `✅ App Store Connect에서 구독 정보 발견: ${subscriptionData.planStatus}`,
            );
          }
        }
      } catch (error) {
        console.log(`⚠️ App Store Connect 확인 실패: ${error.message}`);
      }
    }

    // 🎯 Step 3: App Store에 데이터가 없으면 Firebase에서 확인
    if (!subscriptionData) {
      try {
        const db = admin.firestore();
        const userDoc = await db.collection("users").doc(userId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          subscriptionData = {
            planStatus: userData.planStatus || PlanStatus.FREE,
            expirationDate: userData.expirationDate,
            autoRenewStatus: userData.autoRenewStatus || false,
            hasEverUsedTrial: userData.hasEverUsedTrial || false,
            hasEverUsedPremium: userData.hasEverUsedPremium || false,
          };
          dataSource = "firebase";
          console.log(
            `📱 Firebase에서 구독 정보 사용: ${subscriptionData.planStatus}`,
          );
        }
      } catch (error) {
        console.log(`❌ Firebase 데이터 확인 실패: ${error.message}`);
      }
    }

    // 🎯 Step 4: 둘 다 없으면 기본값
    if (!subscriptionData) {
      subscriptionData = {
        planStatus: PlanStatus.FREE,
        autoRenewStatus: false,
        hasEverUsedTrial: false,
        hasEverUsedPremium: false,
      };
      dataSource = "default";
      console.log(
        `📝 기본값으로 구독 정보 설정: ${subscriptionData.planStatus}`,
      );
    }

    return {
      success: true,
      subscription: subscriptionData,
      dataSource: dataSource,
      version: "v2",
    };
  } catch (error) {
    console.error("구독 상태 확인 오류:", error);
    return {
      success: false,
      error: error.message,
      dataSource: "error",
      version: "v2",
    };
  }
});

module.exports = {
  subCheckSubscriptionStatus,
};
