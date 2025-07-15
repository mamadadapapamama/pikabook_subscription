// 📁 functions/subscription/checkSubscriptionStatus.js
// 🎯 설정 화면 전용: App Store Server API + 캐시 조합
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {Entitlement, SubscriptionStatus} = require("../shared/constant");
const {checkInternalTestAccount} = require("../utils/testAccounts");
const {appStoreServerClient} = require("../utils/appStoreServerClient");
const {
  appstoreKeyId,
  appstoreIssuerId,
  appstorePrivateKey,
  appstoreBundleId,
} = require("../utils/appStoreServerClient");

// 🎯 캐시 유효 시간 (10분)
const CACHE_DURATION_MS = 10 * 60 * 1000;

/**
 * 🎯 설정 화면 전용: App Store Server API + 캐시 조합
 *
 * ✅ 최적화된 전략:
 * 1. 캐시 확인 (빠른 응답)
 * 2. 캐시 만료 시 App Store Server API 호출 (정확한 상태)
 * 3. 새로운 데이터 캐시 저장 (다음 호출 최적화)
 *
 * 🎯 사용 사례: 설정 화면, 내 플랜 조회
 */
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
    console.log("🎯 [Settings] 설정 화면용 구독 상태 조회 시작");

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const userId = request.auth.uid;
    const email = request.auth.token?.email;

    console.log("📱 설정 화면 구독 상태 조회:", {
      userId: userId,
      email: email,
    });

    // 🎯 Step 1: 내부 테스트 계정 확인 (최우선)
    const testAccountResult = checkInternalTestAccount(email);
    if (testAccountResult) {
      console.log("🧪 내부 테스트 계정으로 구독 상태 반환: " +
        testAccountResult.entitlement);
      return {
        success: true,
        subscription: testAccountResult,
        dataSource: "test-account",
        version: "settings-optimized-v1",
      };
    }

    // 🎯 Step 2: 캐시된 구독 상태 확인
    const cachedData = await getCachedSubscriptionStatus(userId);

    if (cachedData && !isCacheExpired(cachedData)) {
      console.log("⚡ 캐시된 구독 상태 반환:", {
        entitlement: cachedData.subscription.entitlement,
        cacheAge: getCacheAge(cachedData) + "ms",
      });

      return {
        success: true,
        subscription: cachedData.subscription,
        dataSource: "cache",
        cacheAge: getCacheAge(cachedData),
        version: "settings-optimized-v1",
      };
    }

    // 🎯 Step 3: 캐시 만료 시 App Store Server API 호출
    console.log("🔍 캐시 만료 또는 없음 - App Store Server API 호출");

    const freshData = await fetchFreshSubscriptionStatus(userId);

    if (freshData) {
      // 🎯 Step 4: 새로운 데이터 캐시에 저장
      await saveCachedSubscriptionStatus(userId, freshData);

      console.log("✅ 최신 구독 상태 조회 완료:", {
        entitlement: freshData.entitlement,
        subscriptionStatus: freshData.subscriptionStatus,
      });

      return {
        success: true,
        subscription: freshData,
        dataSource: "fresh-api",
        cacheAge: 0,
        version: "settings-optimized-v1",
      };
    }

    // 🎯 Step 5: 기본값 반환 (신규 사용자)
    const defaultData = {
      entitlement: Entitlement.FREE,
      subscriptionStatus: SubscriptionStatus.NEVER_SUBSCRIBED,
      hasUsedTrial: false,
      autoRenewEnabled: false,
      hasEverUsedTrial: false,
      hasEverUsedPremium: false,
    };

    console.log("📝 기본값 반환 (신규 사용자)");

    return {
      success: true,
      subscription: defaultData,
      dataSource: "default",
      cacheAge: 0,
      version: "settings-optimized-v1",
    };
  } catch (error) {
    console.error("❌ [Error] 설정 화면 구독 상태 조회 실패:", error);
    return {
      success: false,
      error: error.message,
      dataSource: "error",
      version: "settings-optimized-v1",
    };
  }
});

/**
 * 💾 캐시된 구독 상태 조회
 * @param {string} userId - 사용자 ID
 * @return {Promise<object|null>} 캐시된 데이터
 */
async function getCachedSubscriptionStatus(userId) {
  try {
    const db = admin.firestore();
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      return null;
    }

    const userData = userDoc.data();
    const cachedSubscription = userData.cachedSubscription;

    if (!cachedSubscription || !cachedSubscription.lastCacheAt) {
      return null;
    }

    console.log("📦 캐시된 구독 데이터 발견:", {
      cacheAge: Date.now() - cachedSubscription.lastCacheAt.toMillis() + "ms",
      entitlement: cachedSubscription.subscription?.entitlement,
    });

    return {
      subscription: cachedSubscription.subscription,
      lastCacheAt: cachedSubscription.lastCacheAt,
      cacheSource: cachedSubscription.cacheSource || "unknown",
    };
  } catch (error) {
    console.error("❌ 캐시 조회 실패:", error.message);
    return null;
  }
}

/**
 * ⏰ 캐시 만료 여부 확인
 * @param {object} cachedData - 캐시된 데이터
 * @return {boolean} 만료 여부
 */
function isCacheExpired(cachedData) {
  if (!cachedData.lastCacheAt) {
    return true;
  }

  const cacheAge = Date.now() - cachedData.lastCacheAt.toMillis();
  const isExpired = cacheAge > CACHE_DURATION_MS;

  console.log("⏰ 캐시 만료 확인:", {
    cacheAge: cacheAge + "ms",
    maxAge: CACHE_DURATION_MS + "ms",
    isExpired: isExpired,
  });

  return isExpired;
}

/**
 * 📏 캐시 나이 계산
 * @param {object} cachedData - 캐시된 데이터
 * @return {number} 캐시 나이 (ms)
 */
function getCacheAge(cachedData) {
  if (!cachedData.lastCacheAt) {
    return 0;
  }

  return Date.now() - cachedData.lastCacheAt.toMillis();
}

/**
 * 🔍 App Store Server API로 최신 구독 상태 조회
 * @param {string} userId - 사용자 ID
 * @return {Promise<object|null>} 최신 구독 상태
 */
async function fetchFreshSubscriptionStatus(userId) {
  try {
    // 🎯 Firestore에서 originalTransactionId 조회
    const db = admin.firestore();
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      console.log("⚠️ 사용자 문서 없음 - 신규 사용자");
      return null;
    }

    const userData = userDoc.data();
    const originalTransactionId = userData.originalTransactionId ||
      userData.subscription?.originalTransactionId;

    if (!originalTransactionId) {
      console.log("⚠️ originalTransactionId 없음 - 구매 이력 없음");
      return null;
    }

    console.log("🚀 App Store Server API 호출:", originalTransactionId);

    // 🎯 App Store Server API로 구독 상태 조회
    const subscriptionResult = await appStoreServerClient
      .getSubscriptionStatuses(originalTransactionId);

    if (!subscriptionResult.success) {
      console.error("❌ App Store Server API 호출 실패:", subscriptionResult.error);
      return null;
    }

    // 🎯 구독 상태 분석
    const subscriptionInfo = await analyzeSubscriptionStatuses(
      subscriptionResult.data,
    );

    console.log("✅ 최신 구독 상태 분석 완료:", {
      entitlement: subscriptionInfo.entitlement,
      subscriptionStatus: subscriptionInfo.subscriptionStatus,
    });

    return subscriptionInfo;
  } catch (error) {
    console.error("❌ 최신 구독 상태 조회 실패:", error.message);
    return null;
  }
}

/**
 * 💾 구독 상태 캐시에 저장
 * @param {string} userId - 사용자 ID
 * @param {object} subscriptionData - 구독 상태 데이터
 */
async function saveCachedSubscriptionStatus(userId, subscriptionData) {
  try {
    console.log("💾 구독 상태 캐시에 저장 시작");

    const db = admin.firestore();
    const updateData = {
      cachedSubscription: {
        subscription: subscriptionData,
        lastCacheAt: admin.firestore.FieldValue.serverTimestamp(),
        cacheSource: "app-store-server-api",
        cacheVersion: "settings-optimized-v1",
      },
    };

    await db.collection("users").doc(userId).set(updateData, {merge: true});

    console.log("✅ 구독 상태 캐시 저장 완료");
  } catch (error) {
    console.error("❌ 캐시 저장 실패:", error.message);
    // 캐시 저장 실패해도 메인 기능에는 영향 없음
  }
}

/**
 * 🎯 구독 상태 분석 (간소화 버전)
 * @param {object} subscriptionStatuses - Apple 구독 상태 데이터
 * @return {Promise<object>} 분석된 구독 정보
 */
async function analyzeSubscriptionStatuses(subscriptionStatuses) {
  try {
    // 기본값 설정
    const result = {
      entitlement: Entitlement.FREE,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      hasUsedTrial: false,
      autoRenewEnabled: false,
      subscriptionType: null,
      expirationDate: null,
      hasEverUsedTrial: false,
      hasEverUsedPremium: false,
    };

    // 구독 그룹 데이터 확인
    if (!subscriptionStatuses || !subscriptionStatuses.length) {
      console.log("⚠️ 구독 상태 데이터가 없습니다");
      return result;
    }

    // 첫 번째 구독 그룹의 최신 구독 상태 가져오기
    const subscriptionGroup = subscriptionStatuses[0];
    const lastTransactions = subscriptionGroup.lastTransactions;

    if (!lastTransactions || !lastTransactions.length) {
      console.log("⚠️ 최신 트랜잭션 데이터가 없습니다");
      return result;
    }

    // 🎯 각 트랜잭션의 상태 분석
    for (const transaction of lastTransactions) {
      const status = transaction.status;

      // 🎯 활성 구독 상태 확인
      if (status === 1) { // Active
        result.autoRenewEnabled = true;
        result.entitlement = Entitlement.PREMIUM;
        result.subscriptionStatus = SubscriptionStatus.ACTIVE;
      } else if (status === 2) { // Cancelled but still active
        result.autoRenewEnabled = false;
        result.entitlement = Entitlement.PREMIUM;
        result.subscriptionStatus = SubscriptionStatus.CANCELLING;
      } else if (status === 3) { // Billing retry
        result.autoRenewEnabled = true;
        result.entitlement = Entitlement.PREMIUM;
        result.subscriptionStatus = SubscriptionStatus.ACTIVE;
      } else if (status === 4) { // Grace period
        result.autoRenewEnabled = true;
        result.entitlement = Entitlement.PREMIUM;
        result.subscriptionStatus = SubscriptionStatus.ACTIVE;
      } else if (status === 5) { // Revoked
        result.autoRenewEnabled = false;
        result.entitlement = Entitlement.FREE;
        result.subscriptionStatus = SubscriptionStatus.REFUNDED;
      }
    }

    return result;
  } catch (error) {
    console.error("❌ 구독 상태 분석 중 오류:", error.message);
    return {
      entitlement: Entitlement.FREE,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      hasUsedTrial: false,
      autoRenewEnabled: false,
      error: error.message,
    };
  }
}

module.exports = {
  subCheckSubscriptionStatus,
};
