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
      subscriptionType: null,
      expirationDate: null,
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
    
    // 🎯 새로운 구조 우선 검색
    const originalTransactionId = userData.subscriptionData?.originalTransactionId ||
      userData.originalTransactionId ||
      userData.subscription?.originalTransactionId;

    if (!originalTransactionId) {
      console.log("⚠️ originalTransactionId 없음 - 구매 이력 없음");
      return null;
    }

    console.log("🚀 App Store Server API 호출:", originalTransactionId, {
      dataSource: userData.subscriptionData?.originalTransactionId ? "subscriptionData" : 
                 userData.originalTransactionId ? "root" : "subscription"
    });

    // 🎯 App Store Server API로 구독 상태 조회
    const subscriptionResult = await appStoreServerClient
      .getSubscriptionStatus(originalTransactionId);

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
 * 💾 구독 상태 캐시에 저장 (통합 구조)
 * @param {string} userId - 사용자 ID
 * @param {object} subscriptionData - 구독 상태 데이터
 */
async function saveCachedSubscriptionStatus(userId, subscriptionData) {
  try {
    console.log("💾 구독 상태 캐시에 저장 시작 (통합 구조)");

    const db = admin.firestore();
    
    // 🎯 통합 구독 데이터 구조 (간소화)
    const unifiedSubscriptionData = {
      ...subscriptionData,
      
      // 메타데이터 (간소화)
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdateSource: "checkSubscriptionStatus",
      dataSource: "fresh-api",
      
      // 포맷 변환
      expirationDate: subscriptionData.expirationDate ?
        parseInt(subscriptionData.expirationDate) : null,
    };

    const updateData = {
      // 🎯 통합 구독 데이터 (단일 구조)
      subscriptionData: unifiedSubscriptionData,
    };

    await db.collection("users").doc(userId).set(updateData, {merge: true});

    console.log("✅ 구독 상태 캐시 저장 완료 (통합 구조):", {
      entitlement: subscriptionData.entitlement,
      subscriptionStatus: subscriptionData.subscriptionStatus,
      hasUsedTrial: subscriptionData.hasUsedTrial,
      autoRenewEnabled: subscriptionData.autoRenewEnabled,
    });
  } catch (error) {
    console.error("❌ 캐시 저장 실패:", error.message);
    // 캐시 저장 실패해도 메인 기능에는 영향 없음
  }
}

/**
 * 🎯 구독 상태 분석 (전체 히스토리 기반)
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
    };

    // 구독 그룹 데이터 확인
    if (!subscriptionStatuses || !subscriptionStatuses.length) {
      console.log("⚠️ 구독 상태 데이터가 없습니다");
      return result;
    }

    // 첫 번째 구독 그룹 가져오기
    const subscriptionGroup = subscriptionStatuses[0];
    const lastTransactions = subscriptionGroup.lastTransactions;

    if (!lastTransactions || !lastTransactions.length) {
      console.log("⚠️ 최신 트랜잭션 데이터가 없습니다");
      return result;
    }

    // 🎯 전체 히스토리 조회해서 trial 사용 여부 확인
    const originalTransactionId = await getOriginalTransactionId(lastTransactions);
    if (originalTransactionId) {
      result.hasUsedTrial = await checkTrialUsageFromHistory(originalTransactionId);
    }

    // 🎯 각 트랜잭션의 상태 분석 (현재 상태 확인용)
    for (const transaction of lastTransactions) {
      const signedTransactionInfo = transaction.signedTransactionInfo;
      const status = transaction.status;

      // 🎯 JWT 디코딩하여 트랜잭션 정보 추출
      const decodedTransaction = await decodeTransactionJWT(signedTransactionInfo);

      if (!decodedTransaction.success) {
        console.error("❌ 트랜잭션 JWT 디코딩 실패:", decodedTransaction.error);
        continue;
      }

      const transactionData = decodedTransaction.data;

      // 🎯 구독 타입 및 상태 분석
      const isFreeTrial = transactionData.offerType === 5; // Free Trial
      const now = Date.now();
      const expiresDate = transactionData.expiresDate ?
        parseInt(transactionData.expiresDate) : 0;
      const isExpired = expiresDate > 0 && expiresDate < now;

      // 🎯 구독 타입 결정
      if (transactionData.productId?.includes("yearly")) {
        result.subscriptionType = "yearly";
      } else if (transactionData.productId?.includes("monthly")) {
        result.subscriptionType = "monthly";
      }

      // 🎯 만료일 설정
      if (expiresDate > 0) {
        result.expirationDate = expiresDate.toString();
      }

      // 🎯 활성 구독 상태 확인
      if (status === 1) { // Active
        result.autoRenewEnabled = true;
        result.expirationDate = expiresDate.toString();

        if (isFreeTrial) {
          result.entitlement = Entitlement.TRIAL;
        } else {
          result.entitlement = Entitlement.PREMIUM;
        }
        result.subscriptionStatus = SubscriptionStatus.ACTIVE;
      } else if (status === 2) { // Cancelled but still active
        result.autoRenewEnabled = false;
        result.expirationDate = expiresDate.toString();

        if (isFreeTrial) {
          result.entitlement = isExpired ? Entitlement.FREE : Entitlement.TRIAL;
        } else {
          result.entitlement = isExpired ? Entitlement.FREE : Entitlement.PREMIUM;
        }

        if (isExpired) {
          result.subscriptionStatus = SubscriptionStatus.EXPIRED;
        } else {
          result.subscriptionStatus = SubscriptionStatus.CANCELLING;
        }
      } else if (status === 3) { // Billing retry
        result.autoRenewEnabled = true;
        result.expirationDate = expiresDate.toString();
        result.entitlement = Entitlement.PREMIUM;
        result.subscriptionStatus = SubscriptionStatus.ACTIVE;
      } else if (status === 4) { // Grace period
        result.autoRenewEnabled = true;
        result.expirationDate = expiresDate.toString();
        result.entitlement = Entitlement.PREMIUM;
        result.subscriptionStatus = SubscriptionStatus.ACTIVE;
      } else if (status === 5) { // Revoked
        result.autoRenewEnabled = false;
        result.entitlement = Entitlement.FREE;
        result.subscriptionStatus = SubscriptionStatus.REFUNDED;
      }
    }

    console.log("✅ 구독 상태 분석 완료:", {
      entitlement: result.entitlement,
      subscriptionStatus: result.subscriptionStatus,
      hasUsedTrial: result.hasUsedTrial,
      autoRenewEnabled: result.autoRenewEnabled,
      subscriptionType: result.subscriptionType,
    });

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

/**
 * 🔍 originalTransactionId 추출
 * @param {Array} lastTransactions - 최신 트랜잭션 배열
 * @return {Promise<string|null>} originalTransactionId
 */
async function getOriginalTransactionId(lastTransactions) {
  try {
    if (!lastTransactions || !lastTransactions.length) {
      return null;
    }

    const firstTransaction = lastTransactions[0];
    const decodedTransaction = await decodeTransactionJWT(firstTransaction.signedTransactionInfo);
    
    if (decodedTransaction.success) {
      return decodedTransaction.data.originalTransactionId;
    }

    return null;
  } catch (error) {
    console.error("❌ originalTransactionId 추출 실패:", error.message);
    return null;
  }
}

/**
 * 🔍 전체 히스토리에서 trial 사용 여부 확인
 * @param {string} originalTransactionId - 원본 트랜잭션 ID
 * @return {Promise<boolean>} trial 사용 여부
 */
async function checkTrialUsageFromHistory(originalTransactionId) {
  try {
    console.log("🔍 전체 히스토리에서 trial 사용 여부 확인 시작:", originalTransactionId);

    // App Store Server API로 전체 히스토리 조회
    const historyResult = await appStoreServerClient.getTransactionHistory(originalTransactionId);
    
    if (!historyResult.success) {
      console.error("❌ 트랜잭션 히스토리 조회 실패:", historyResult.error);
      return false;
    }

    const transactions = historyResult.data.signedTransactions || [];
    console.log(`📋 전체 트랜잭션 수: ${transactions.length}`);

    // 모든 트랜잭션을 확인하여 trial 사용 여부 체크
    for (const signedTransaction of transactions) {
      const decodedTransaction = await decodeTransactionJWT(signedTransaction);
      
      if (!decodedTransaction.success) {
        continue;
      }

      const transactionData = decodedTransaction.data;
      const isFreeTrial = transactionData.offerType === 5; // Free Trial
      
      if (isFreeTrial) {
        console.log("✅ 히스토리에서 trial 사용 확인됨:", {
          transactionId: transactionData.transactionId,
          productId: transactionData.productId,
          offerType: transactionData.offerType,
        });
        return true;
      }
    }

    console.log("❌ 히스토리에서 trial 사용 확인되지 않음");
    return false;
  } catch (error) {
    console.error("❌ 히스토리 trial 확인 중 오류:", error.message);
    return false;
  }
}

/**
 * 🔓 트랜잭션 JWT 디코딩
 * @param {string} signedTransaction - 서명된 트랜잭션 정보
 * @return {Promise<object>} 디코딩 결과
 */
async function decodeTransactionJWT(signedTransaction) {
  try {
    const parts = signedTransaction.split(".");
    if (parts.length !== 3) {
      return {
        success: false,
        error: "Invalid JWT format",
      };
    }

    const payload = parts[1];
    const decodedPayload = Buffer.from(payload, "base64url").toString("utf8");
    const parsedPayload = JSON.parse(decodedPayload);

    return {
      success: true,
      data: parsedPayload,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  subCheckSubscriptionStatus,
};
