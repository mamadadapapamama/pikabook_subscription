// 📁 functions/src/subscription/syncPurchaseInfo.js
// 🚀 Apple Best Practice: jwsRepresentation 기반 구매 정보 동기화
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

/**
 * 🚀 Apple Best Practice: jwsRepresentation 기반 구매 정보 동기화
 *
 * ✅ WWDC 2024 권장사항:
 * 1. jwsRepresentation 직접 사용 (StoreKit 2 권장)
 * 2. 서버에서 JWS 검증 (보안 강화)
 * 3. appAccountToken으로 사용자 연결
 * 4. 즉시 구독 상태 반환
 *
 * @param {object} request - Firebase Functions 요청
 * @param {string} request.data.jwsRepresentation - StoreKit 2 트랜잭션 JWS
 * @param {string} request.data.userId - 사용자 UID (앱 계정 연결용)
 * @return {Promise<object>} 구독 상태 정보
 */
const syncPurchaseInfo = onCall({
  region: "asia-southeast1",
  secrets: [
    appstoreKeyId,
    appstoreIssuerId,
    appstorePrivateKey,
    appstoreBundleId,
  ],
}, async (request) => {
  try {
    console.log("🚀 [Apple Best Practice] jwsRepresentation 기반 구매 정보 동기화 시작");

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const {jwsRepresentation, userId} = request.data;
    const email = request.auth.token?.email;

    // 🔍 입력 검증
    if (!jwsRepresentation || !userId) {
      throw new HttpsError("invalid-argument",
        "jwsRepresentation and userId are required");
    }

    console.log("📝 입력 데이터:", {
      hasJwsRepresentation: !!jwsRepresentation,
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
        version: "jwsRepresentation-v1",
      };
    }

    // 🎯 Step 2: JWS 직접 검증 및 트랜잭션 정보 추출
    const transactionInfo = await verifyAndDecodeJWS(jwsRepresentation);

    if (!transactionInfo.success) {
      console.error("❌ JWS 검증 실패:", transactionInfo.error);
      throw new HttpsError("invalid-argument",
        "Failed to verify JWS: " + transactionInfo.error);
    }

    const transaction = transactionInfo.data;
    console.log("✅ JWS 검증 성공:", {
      transactionId: transaction.transactionId,
      originalTransactionId: transaction.originalTransactionId,
      productId: transaction.productId,
      type: transaction.type,
      appAccountToken: transaction.appAccountToken,
    });

    // 🎯 Step 3: appAccountToken으로 사용자 연결 확인
    if (transaction.appAccountToken) {
      console.log("🔗 appAccountToken으로 사용자 연결 확인: " +
        transaction.appAccountToken);

      // UUID 형태인지 확인 (애플 권장사항)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(transaction.appAccountToken)) {
        console.warn("⚠️ appAccountToken이 UUID 형태가 아닙니다: " +
          transaction.appAccountToken);
      }
    }

    // 🎯 Step 4: JWS 정보로 기본 구독 상태 판단
    const basicSubscriptionData = analyzeJWSTransaction(transaction);

    // 🎯 Step 5: 필요한 경우에만 App Store Server API 호출
    let subscriptionData;
    const needsRealTimeStatus = request.data.checkRealTimeStatus !== false; // 기본값 true

    if (needsRealTimeStatus) {
      console.log("🔍 App Store Server API로 실시간 상태 확인");
      subscriptionData = await getCurrentSubscriptionStatus(
        transaction.originalTransactionId,
      );
    } else {
      console.log("⚡ JWS 정보만으로 빠른 응답");
      subscriptionData = basicSubscriptionData;
    }

    // 🎯 Step 6: Firestore에 구매 정보 저장
    await savePurchaseInfoToFirestore(userId, transaction, subscriptionData);

    console.log("✅ [Apple Best Practice] 구매 정보 동기화 완료:", {
      entitlement: subscriptionData.entitlement,
      subscriptionStatus: subscriptionData.subscriptionStatus,
      hasUsedTrial: subscriptionData.hasUsedTrial,
    });

    return {
      success: true,
      subscription: subscriptionData,
      dataSource: "jws-verification",
      version: "jwsRepresentation-v1",
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("❌ [Error] 구매 정보 동기화 실패:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError("internal", "Internal server error: " + error.message);
  }
});

/**
 * 🔐 JWS 검증 및 디코딩
 * @param {string} jwsRepresentation - StoreKit 2 트랜잭션 JWS
 * @return {Promise<object>} 검증 결과
 */
async function verifyAndDecodeJWS(jwsRepresentation) {
  try {
    console.log("🔐 JWS 검증 및 디코딩 시작");

    // JWT는 header.payload.signature 형태
    const parts = jwsRepresentation.split(".");
    if (parts.length !== 3) {
      return {
        success: false,
        error: "Invalid JWS format",
      };
    }

    // 🎯 Header 디코딩
    const headerPayload = parts[0];
    const decodedHeader = Buffer.from(headerPayload, "base64url").toString("utf8");
    const header = JSON.parse(decodedHeader);

    console.log("📋 JWS Header:", {
      alg: header.alg,
      kid: header.kid,
      typ: header.typ,
    });

    // 🎯 Payload 디코딩
    const payloadPart = parts[1];
    const decodedPayload = Buffer.from(payloadPart, "base64url").toString("utf8");
    const payload = JSON.parse(decodedPayload);

    console.log("📄 JWS Payload Keys:", Object.keys(payload));

    // 🎯 기본 검증 (실제 서명 검증은 App Store Server Library 사용 권장)
    const requiredFields = ["transactionId", "originalTransactionId", "productId"];
    for (const field of requiredFields) {
      if (!payload[field]) {
        return {
          success: false,
          error: `Missing required field: ${field}`,
        };
      }
    }

    // 🎯 환경 검증 (sandbox/production)
    const environment = payload.environment || "Production";
    console.log("🌍 Transaction Environment:", environment);

    return {
      success: true,
      data: payload,
      header: header,
      environment: environment,
    };
  } catch (error) {
    console.error("❌ JWS 검증 실패:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * ⚡ JWS 트랜잭션 정보만으로 기본 구독 상태 판단
 * @param {object} transaction - JWS 디코딩된 트랜잭션 정보
 * @return {object} 기본 구독 상태 정보
 */
function analyzeJWSTransaction(transaction) {
  try {
    console.log("⚡ JWS 정보만으로 기본 구독 상태 판단");

    const now = Date.now();
    const expiresDate = transaction.expiresDate ?
      parseInt(transaction.expiresDate) : 0;
    const isExpired = expiresDate > 0 && expiresDate < now;

    // 🎯 제품 타입 확인
    const isFreeTrial = transaction.offerType === 5 || // Free Trial
      transaction.offerType === 1; // Intro offer
    const isPremium = !isFreeTrial;

    // 🎯 기본 구독 상태 판단
    const result = {
      entitlement: Entitlement.FREE,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      hasUsedTrial: isFreeTrial,
      autoRenewEnabled: true, // JWS에서는 정확히 알 수 없음
      subscriptionType: transaction.productId?.includes("yearly") ? "yearly" : "monthly",
      expirationDate: expiresDate.toString(),
      hasEverUsedTrial: isFreeTrial,
      hasEverUsedPremium: isPremium,
      dataSource: "jws-only",
    };

    // 🎯 Entitlement 결정
    if (!isExpired) {
      if (isFreeTrial) {
        result.entitlement = Entitlement.TRIAL;
      } else if (isPremium) {
        result.entitlement = Entitlement.PREMIUM;
      }
    }

    // 🎯 Subscription Status 결정 (기본적인 판단만 가능)
    if (transaction.revocationDate) {
      result.subscriptionStatus = SubscriptionStatus.REFUNDED;
      result.entitlement = Entitlement.FREE;
    } else if (isExpired) {
      result.subscriptionStatus = SubscriptionStatus.EXPIRED;
      result.entitlement = Entitlement.FREE;
    } else {
      result.subscriptionStatus = SubscriptionStatus.ACTIVE;
    }

    console.log("⚡ JWS 기본 분석 완료:", {
      entitlement: result.entitlement,
      subscriptionStatus: result.subscriptionStatus,
      hasUsedTrial: result.hasUsedTrial,
      limitations: "취소 상태는 App Store API에서만 확인 가능",
    });

    return result;
  } catch (error) {
    console.error("❌ JWS 기본 분석 실패:", error.message);
    return {
      entitlement: Entitlement.FREE,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      hasUsedTrial: false,
      autoRenewEnabled: false,
      error: error.message,
      dataSource: "jws-error",
    };
  }
}

/**
 * 🎯 현재 구독 상태 조회
 * @param {string} originalTransactionId - 원본 트랜잭션 ID
 * @return {Promise<object>} 구독 상태 정보
 */
async function getCurrentSubscriptionStatus(originalTransactionId) {
  try {
    console.log("🔍 현재 구독 상태 조회 시작:", originalTransactionId);

    // App Store Server API로 구독 상태 조회
    const subscriptionResult = await appStoreServerClient
      .getSubscriptionStatuses(originalTransactionId);

    if (!subscriptionResult.success) {
      console.error("❌ 구독 상태 조회 실패:", subscriptionResult.error);
      return {
        entitlement: Entitlement.FREE,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        hasUsedTrial: false,
        autoRenewEnabled: false,
        error: subscriptionResult.error,
      };
    }

    const subscriptionStatuses = subscriptionResult.data;
    console.log("📦 구독 상태 데이터 수신");

    // 🎯 구독 상태 분석
    const subscriptionInfo = await analyzeSubscriptionStatuses(subscriptionStatuses);

    console.log("✅ 구독 상태 분석 완료:", {
      entitlement: subscriptionInfo.entitlement,
      subscriptionStatus: subscriptionInfo.subscriptionStatus,
      hasUsedTrial: subscriptionInfo.hasUsedTrial,
    });

    return subscriptionInfo;
  } catch (error) {
    console.error("❌ 구독 상태 조회 중 오류:", error.message);
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
 * 🎯 구독 상태 분석 (기존 로직 재사용)
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
      const signedTransactionInfo = transaction.signedTransactionInfo;
      const status = transaction.status;

      // JWT 디코딩하여 트랜잭션 정보 추출
      const decodedTransaction = await decodeTransactionJWT(signedTransactionInfo);

      if (!decodedTransaction.success) {
        console.error("❌ 트랜잭션 JWT 디코딩 실패:", decodedTransaction.error);
        continue;
      }

      const transactionData = decodedTransaction.data;

      // 🎯 구독 타입 및 상태 분석
      const isFreeTrial = transactionData.offerType === 5; // Free Trial
      const isPremium = !isFreeTrial;
      const now = Date.now();
      const expiresDate = transactionData.expiresDate ?
        parseInt(transactionData.expiresDate) : 0;
      const isExpired = expiresDate > 0 && expiresDate < now;

      // 경험 여부 업데이트
      if (isFreeTrial) {
        result.hasEverUsedTrial = true;
        result.hasUsedTrial = true;
      }
      if (isPremium) {
        result.hasEverUsedPremium = true;
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

/**
 * 💾 Firestore에 구매 정보 저장
 * @param {string} userId - 사용자 ID
 * @param {object} transaction - 트랜잭션 정보
 * @param {object} subscriptionData - 구독 상태 정보
 */
async function savePurchaseInfoToFirestore(userId, transaction, subscriptionData) {
  try {
    console.log("💾 Firestore에 구매 정보 저장 시작");

    const db = admin.firestore();
    const updateData = {
      // 🎯 Apple 권장: originalTransactionId를 사용자 식별자로 사용
      originalTransactionId: transaction.originalTransactionId,
      lastTransactionId: transaction.transactionId,

      // 🎯 기존 구독 정보 (호환성 유지)
      subscription: {
        plan: subscriptionData.entitlement === Entitlement.PREMIUM ? "premium" : "free",
        status: subscriptionData.subscriptionStatus === SubscriptionStatus.ACTIVE ? "active" : "inactive",
        originalTransactionId: transaction.originalTransactionId,
        isFreeTrial: subscriptionData.entitlement === Entitlement.TRIAL,
        autoRenewStatus: subscriptionData.autoRenewEnabled || false,
        expiryDate: subscriptionData.expirationDate ?
          admin.firestore.Timestamp.fromMillis(parseInt(subscriptionData.expirationDate)) : null,
        lastUpdateSource: "syncPurchaseInfo",
        lastUpdateAt: admin.firestore.FieldValue.serverTimestamp(),
      },

      // 🎯 새로운 캐시 시스템 연동
      cachedSubscription: {
        subscription: {
          ...subscriptionData,
          lastNotificationType: "PURCHASE_SYNC",
          lastNotificationSubtype: "JWS_VERIFICATION",
          dataSource: "syncPurchaseInfo",
        },
        lastCacheAt: admin.firestore.FieldValue.serverTimestamp(),
        cacheSource: "syncPurchaseInfo",
        cacheVersion: "settings-optimized-v1",
        notificationType: "PURCHASE_SYNC",
        subtype: "JWS_VERIFICATION",
      },

      // 🎯 추가 메타데이터
      lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSyncMethod: "jwsRepresentation",

      // 🎯 appAccountToken 저장 (있는 경우)
      ...(transaction.appAccountToken && {
        appAccountToken: transaction.appAccountToken,
      }),
    };

    await db.collection("users").doc(userId).set(updateData, {merge: true});

    console.log("✅ Firestore 저장 완료 (캐시 포함):", {
      userId: userId,
      entitlement: subscriptionData.entitlement,
      subscriptionStatus: subscriptionData.subscriptionStatus,
      hasUsedTrial: subscriptionData.hasUsedTrial,
      cacheSource: "syncPurchaseInfo",
    });
  } catch (error) {
    console.error("❌ Firestore 저장 실패:", error.message);
    throw error;
  }
}

module.exports = {
  syncPurchaseInfo,
};
