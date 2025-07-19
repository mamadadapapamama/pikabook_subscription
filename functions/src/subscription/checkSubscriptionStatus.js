// 📁 functions/subscription/checkSubscriptionStatus.js
// 🎯 설정 화면 전용: App Store Server API + 캐시 조합
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {Entitlement, SubscriptionStatus} = require("../shared/constant");
const {checkInternalTestAccount} = require("../utils/testAccounts");
const {appStoreServerClient} = require("../utils/appStoreServerClient");
const {getUnifiedSubscriptionData, updateUnifiedSubscriptionData} = require("../utils/subscriptionDataManager");
const {
  appstoreKeyId,
  appstoreIssuerId,
  appstorePrivateKey,
  appstoreBundleId,
  appstoreEnvironment,
} = require("../utils/appStoreServerClient");
const {inAppPurchaseClient} = require("../utils/inAppPurchaseClient");

// 🎯 캐시 유효 시간 (10분)
const CACHE_DURATION_MS = 10 * 60 * 1000;

// 🎯 중복 호출 방지 시간 (5분) - 구독 상태는 자주 변경되지 않음
const DUPLICATE_CALL_PREVENTION_MS = 5 * 60 * 1000;

// 🎯 디버그 모드 설정 (환경 변수 기반)
const kDebugMode = process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true';

// 🎯 중복 호출 방지용 맵
const userCallTimestamps = new Map();

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
    appstoreEnvironment,
  ],
}, async (request) => {
  try {
    console.log("🎯 [Settings] Firestore 기반 구독 상태 조회 시작");

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const userId = request.auth.uid;
    const email = request.auth.token?.email;
    const forceRefresh = request.data?.forceRefresh || false;

    console.log("📱 설정 화면 구독 상태 조회:", {
      userId: userId,
      email: email,
      forceRefresh: forceRefresh,
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
        version: "firestore-only-v3",
      };
    }

    // 🎯 Step 2: Firestore에서 구독 상태 조회
    const subscriptionData = await getCachedSubscriptionStatus(userId);

    if (subscriptionData) {
      console.log("⚡️ Firestore에서 구독 상태 반환:", {
        entitlement: subscriptionData.entitlement,
        status: subscriptionData.subscriptionStatus,
        source: subscriptionData.lastUpdateSource,
      });

      return {
        success: true,
        subscription: subscriptionData,
        dataSource: "firestore",
        isStale: isCacheExpired(subscriptionData), // 데이터가 오래되었는지 여부 플래그
        version: "firestore-only-v3",
      };
    }
    
    // 🎯 Step 3: 구독 정보가 없는 경우 (신규 사용자 등)
    const unverifiedData = {
      entitlement: Entitlement.FREE,
      subscriptionStatus: SubscriptionStatus.UNVERIFIED,
      message: "Purchase info not found. Please sync your purchase from the app.",
    };

    console.log("📝 구매 미확인(UNVERIFIED) 상태 반환");

    return {
      success: true,
      subscription: unverifiedData,
      dataSource: "unverified-firestore",
      version: "firestore-only-v3",
    };
  } catch (error) {
    console.error("❌ [Error] 설정 화면 구독 상태 조회 실패:", error);
    return {
      success: false,
      error: error.message,
      dataSource: "error",
      version: "firestore-only-v3",
    };
  }
});

/**
 * 💾 Firestore에서 구독 상태 조회 (이전의 캐시 조회와 동일)
 * @param {string} userId - 사용자 ID
 * @return {Promise<object|null>} 캐시된 데이터
 */
async function getCachedSubscriptionStatus(userId) {
  try {
    const db = admin.firestore();
    const subscriptionData = await getUnifiedSubscriptionData(db, userId);
    
    if (subscriptionData && subscriptionData.lastUpdatedAt) {
      console.log("📦 통합 구독 데이터 발견:", {
        cacheAge: Date.now() - subscriptionData.lastUpdatedAt.toMillis() + "ms",
        entitlement: subscriptionData.entitlement,
        lastUpdateSource: subscriptionData.lastUpdateSource,
        dataVersion: subscriptionData.dataVersion,
      });

      return subscriptionData;
    }

    return null;
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
  if (!cachedData.lastUpdatedAt) {
    return true; // 업데이트 시간이 없으면 오래된 것으로 간주
  }

  const cacheAge = Date.now() - cachedData.lastUpdatedAt.toMillis();
  const isExpired = cacheAge > CACHE_DURATION_MS;

  if (kDebugMode) {
    console.log("⏰ 데이터 최신 여부 확인:", {
      cacheAge: cacheAge + "ms",
      maxAge: CACHE_DURATION_MS + "ms",
      isStale: isExpired,
    });
  }

  return isExpired;
}

/**
 * 📏 캐시 나이 계산
 * @param {object} cachedData - 캐시된 데이터
 * @return {number} 캐시 나이 (ms)
 */
function getCacheAge(cachedData) {
  if (!cachedData.lastUpdatedAt) {
    return 0;
  }

  return Date.now() - cachedData.lastUpdatedAt.toMillis();
}

module.exports = {
  subCheckSubscriptionStatus,
};
