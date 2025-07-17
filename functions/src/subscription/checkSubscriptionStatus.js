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
  appstoreEnvironment,
} = require("../utils/appStoreServerClient");

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
    console.log("🎯 [Settings] 설정 화면용 구독 상태 조회 시작");

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const userId = request.auth.uid;
    const email = request.auth.token?.email;
    const forceRefresh = request.data?.forceRefresh || false;
    const now = Date.now();

    // 🎯 중복 호출 감지 (1초 내 호출 제한)
    const lastCallTime = userCallTimestamps.get(userId);
    if (!forceRefresh && lastCallTime && (now - lastCallTime) < DUPLICATE_CALL_PREVENTION_MS) {
      console.log(`⚠️ 중복 호출 감지: ${userId}, 간격: ${now - lastCallTime}ms`);
      
      // 캐시된 데이터 즉시 반환
      const cachedData = await getCachedSubscriptionStatus(userId);
      if (cachedData) {
        return {
          success: true,
          subscription: cachedData.subscription,
          dataSource: "duplicate-call-prevention",
          callInterval: now - lastCallTime,
          warning: "중복 호출 방지로 캐시 응답",
          version: "settings-optimized-v1",
        };
      }
    }

    // 호출 시간 기록
    userCallTimestamps.set(userId, now);

    console.log("📱 설정 화면 구독 상태 조회:", {
      userId: userId,
      email: email,
      forceRefresh: forceRefresh,
      callInterval: lastCallTime ? `${now - lastCallTime}ms` : "첫 호출",
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

    // 🎯 Step 2: 강제 새로고침 확인
    if (forceRefresh) {
      console.log("🔄 강제 새로고침 - 캐시 무시하고 바로 API 호출");
    } else {
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

      console.log("🔍 캐시 만료 또는 없음 - App Store Server API 호출");
    }

    // 🎯 Step 3: App Store Server API 호출 (캐시 만료 또는 강제 새로고침)

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
        dataSource: forceRefresh ? "force-refresh" : "fresh-api",
        cacheAge: 0,
        forceRefresh: forceRefresh,
        version: "settings-optimized-v1",
      };
    }

    // 🎯 Step 5: 기본값 반환 (신규 사용자)
    const defaultData = {
      entitlement: Entitlement.FREE,
      subscriptionStatus: SubscriptionStatus.NEVER_SUBSCRIBED,
      hasUsedTrial: false,
      autoRenewEnabled: false,
      subscriptionType: null,
      expirationDate: null,
    };

    console.log("📝 기본값 반환 (신규 사용자)");

    return {
      success: true,
      subscription: defaultData,
      dataSource: "default",
      cacheAge: 0,
      forceRefresh: forceRefresh,
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
 * 💾 캐시된 구독 상태 조회 (통합 구조)
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
    const subscriptionData = userData.subscriptionData;
    
    if (subscriptionData && subscriptionData.lastUpdatedAt) {
      console.log("📦 통합 구독 데이터 발견:", {
        cacheAge: Date.now() - subscriptionData.lastUpdatedAt.toMillis() + "ms",
        entitlement: subscriptionData.entitlement,
        dataSource: subscriptionData.dataSource,
      });

      return {
        subscription: subscriptionData,
        lastCacheAt: subscriptionData.lastUpdatedAt,
        cacheSource: subscriptionData.lastUpdateSource || "unknown",
      };
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
 * 🔍 App Store Server API로 최신 구독 상태 조회 (단순화)
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
    
    // 🎯 새로운 구조 우선 검색
    const originalTransactionId = userData.subscriptionData?.originalTransactionId ||
      userData.originalTransactionId ||
      userData.subscription?.originalTransactionId;

    // 🎯 최신 트랜잭션 ID 추출 (API 호출용)
    const lastTransactionId = userData.subscriptionData?.lastTransactionId || 
      userData.lastTransactionId ||
      originalTransactionId;

    if (!lastTransactionId) {
      console.log("⚠️ transactionId 없음 - 구매 이력 없음");
      return null;
    }

    console.log("🚀 App Store Server API 호출 (단순화):", {
      lastTransactionId: kDebugMode ? lastTransactionId : "***",
      originalTransactionId: kDebugMode ? originalTransactionId : "***",
      dataSource: userData.subscriptionData?.lastTransactionId ? "subscriptionData" : 
                 userData.lastTransactionId ? "root" : "original"
    });

    // 🎯 단순한 Transaction Info 조회 (History 분석 없음)
    console.log("🔄 단순한 getTransactionInfo 호출 (웹훅에서 History 분석 완료)");
    const transactionResult = await appStoreServerClient
      .getTransactionInfo(lastTransactionId);

    if (!transactionResult.success) {
      console.error("❌ Transaction Info 호출 실패:", transactionResult.error);
      return null;
    }

    // 🎯 단순한 트랜잭션 정보 기반 기본 상태 (웹훅이 정확한 상태 업데이트)
    const transactionInfo = transactionResult.data;
    const basicSubscriptionInfo = await createBasicSubscriptionInfo(transactionInfo);

    console.log("✅ 기본 구독 상태 조회 완료 (웹훅이 정확한 상태 관리):", {
      entitlement: basicSubscriptionInfo.entitlement,
      subscriptionStatus: basicSubscriptionInfo.subscriptionStatus,
      note: "웹훅에서 정확한 상태를 실시간 업데이트함",
    });

    return basicSubscriptionInfo;
  } catch (error) {
    console.error("❌ 기본 구독 상태 조회 실패:", error.message);
    return null;
  }
}

/**
 * 🎯 기본 구독 정보 생성 (단순화)
 * @param {object} transactionInfo - 트랜잭션 정보
 * @return {Promise<object>} 기본 구독 정보
 */
async function createBasicSubscriptionInfo(transactionInfo) {
  try {
    // 기본값 설정
    const result = {
      entitlement: Entitlement.FREE,
      subscriptionStatus: SubscriptionStatus.NEVER_SUBSCRIBED,
      hasUsedTrial: false, // 웹훅에서 정확한 값 업데이트
      autoRenewEnabled: false,
      subscriptionType: null,
      expirationDate: null,
      
      // 🎯 Apple Best Practice: 중요한 추가 정보들 (기본값)
      hasFamilySharedSubscription: false,
      environment: null,
      subscriptionStartDate: null,
      userAccountToken: null,
    };

    const decodedTransaction = decodeJWS(transactionInfo.signedTransactionInfo);
    
    if (!decodedTransaction) {
      console.log("⚠️ 트랜잭션 정보 디코딩 실패");
      return result;
    }

    const transactionData = decodedTransaction;
    const now = Date.now();
    const expiresDate = parseInt(transactionData.expiresDate) || 0;
    const isExpired = expiresDate > 0 && expiresDate < now;
    const isRevoked = !!transactionData.revocationDate;
    const isCurrentTransactionTrial = transactionData.offerType === 1;

    result.expirationDate = expiresDate.toString();

    console.log("🎯 기본 트랜잭션 정보 분석:", {
      transactionId: kDebugMode ? transactionData.transactionId : "***",
      productId: transactionData.productId,
      offerType: transactionData.offerType,
      isExpired: isExpired,
      isRevoked: isRevoked,
      isCurrentTransactionTrial: isCurrentTransactionTrial,
      expiresDate: new Date(expiresDate).toISOString(),
      note: "웹훅에서 정확한 hasUsedTrial 값 업데이트",
    });

    // 🎯 기본 Entitlement 결정 (웹훅이 정확한 상태 업데이트)
    if (isRevoked) {
      result.entitlement = Entitlement.FREE;
      result.subscriptionStatus = SubscriptionStatus.REFUNDED;
      console.log("🚫 구독 취소됨 (Revoked)");
    } else if (isExpired) {
      result.entitlement = Entitlement.FREE;
      result.subscriptionStatus = SubscriptionStatus.EXPIRED;
      console.log("⏰ 구독 만료됨 (Expired)");
    } else {
      // 아직 유효한 구독
      if (isCurrentTransactionTrial) {
        result.entitlement = Entitlement.TRIAL;
        result.subscriptionStatus = SubscriptionStatus.ACTIVE;
        console.log("🎯 현재 활성 Trial 구독");
      } else {
        result.entitlement = Entitlement.PREMIUM;
        result.subscriptionStatus = SubscriptionStatus.ACTIVE;
        console.log("💎 현재 활성 Premium 구독");
      }
      result.autoRenewEnabled = true;
    }

    // 🎯 구독 타입 결정
    if (transactionData.productId?.includes("yearly")) {
      result.subscriptionType = "yearly";
    } else if (transactionData.productId?.includes("monthly")) {
      result.subscriptionType = "monthly";
    }

    // 🎯 Apple Best Practice: 중요한 추가 정보들
    result.hasFamilySharedSubscription = transactionData.inAppOwnershipType === "FAMILY_SHARED";
    result.environment = transactionData.environment;
    result.subscriptionStartDate = transactionData.originalPurchaseDate;
    
    console.log("✅ 기본 구독 정보 생성 완료:", {
      entitlement: result.entitlement,
      subscriptionStatus: result.subscriptionStatus,
      hasUsedTrial: result.hasUsedTrial,
      autoRenewEnabled: result.autoRenewEnabled,
      subscriptionType: result.subscriptionType,
      hasFamilySharedSubscription: result.hasFamilySharedSubscription,
      environment: result.environment,
      note: "웹훅에서 정확한 상태를 실시간 업데이트함",
    });

    return result;
  } catch (error) {
    console.error("❌ 기본 구독 정보 생성 실패:", error.message);
    return {
      entitlement: Entitlement.FREE,
      subscriptionStatus: SubscriptionStatus.NEVER_SUBSCRIBED,
      hasUsedTrial: false,
      autoRenewEnabled: false,
      subscriptionType: null,
      expirationDate: null,
      
      // 🎯 Apple Best Practice: 중요한 추가 정보들
      hasFamilySharedSubscription: false,
      environment: null,
      subscriptionStartDate: null,
      userAccountToken: null,
      
      error: error.message,
    };
  }
}

/**
 * 💾 구독 상태 캐시에 저장 (통합 구조)
 * @param {string} userId - 사용자 ID
 * @param {object} subscriptionData - 구독 상태 데이터
 */
async function saveCachedSubscriptionStatus(userId, subscriptionData) {
  try {
    console.log("💾 구독 상태 캐시에 저장 시작 (통합 구조)");

    const db = admin.firestore();
    
    // 🎯 민감한 정보 제외 (Firestore 저장용)
    const {userAccountToken, ...safeSubscriptionData} = subscriptionData;
    
    // 🎯 통합 구독 데이터 구조 (간소화)
    const unifiedSubscriptionData = {
      ...safeSubscriptionData,
      
      // 메타데이터 (간소화)
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdateSource: "checkSubscriptionStatus",
      dataSource: "fresh-api",
      
      // 포맷 변환
      expirationDate: safeSubscriptionData.expirationDate ?
        parseInt(safeSubscriptionData.expirationDate) : null,
    };

    const updateData = {
      // 🎯 통합 구독 데이터 (단일 구조)
      subscriptionData: unifiedSubscriptionData,
    };

    await db.collection("users").doc(userId).set(updateData, {merge: true});

    console.log("✅ 구독 상태 캐시 저장 완료 (통합 구조):", {
      entitlement: safeSubscriptionData.entitlement,
      subscriptionStatus: safeSubscriptionData.subscriptionStatus,
      hasUsedTrial: safeSubscriptionData.hasUsedTrial,
      autoRenewEnabled: safeSubscriptionData.autoRenewEnabled,
      userAccountToken: userAccountToken ? "*** (저장되지 않음)" : null,
    });
  } catch (error) {
    console.error("❌ 캐시 저장 실패:", error.message);
    // 캐시 저장 실패해도 메인 기능에는 영향 없음
  }
}





// 🎯 analyzeTransactionHistory 함수 제거됨 - 웹훅으로 이동됨

// 🎯 getOfferTypeDescription 함수 제거됨 - 웹훅으로 이동됨

/**
 * JWS(JSON Web Signature) 디코딩 (검증 없이)
 * @param {string} jws - JSON Web Signature 문자열
 * @return {Object|null} 디코딩된 페이로드 또는 null
 */
function decodeJWS(jws) {
  try {
    // JWT의 중간 부분(payload)만 디코딩
    const parts = jws.split(".");
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1];
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    return JSON.parse(decoded);
  } catch (error) {
    console.error("JWS 디코딩 오류:", error);
    return null;
  }
}





module.exports = {
  subCheckSubscriptionStatus,
};
