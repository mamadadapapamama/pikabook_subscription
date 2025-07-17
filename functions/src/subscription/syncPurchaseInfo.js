// 📁 functions/src/subscription/syncPurchaseInfo.js
// 🚀 Apple Best Practice: jwsRepresentation 기반 구매 정보 동기화
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {Entitlement, SubscriptionStatus} = require("../shared/constant");
const {checkInternalTestAccount} = require("../utils/testAccounts");
const {inAppPurchaseClient} = require("../utils/appStoreServerClient");
const {
  iapKeyId,
  iapIssuerId,
  iapPrivateKey,
  iapBundleId,
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
    iapKeyId,
    iapIssuerId,
    iapPrivateKey,
    iapBundleId,
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
    const transactionInfo = await inAppPurchaseClient.verifyJWS(jwsRepresentation);

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

    // 🎯 Step 4: Firestore에 JWS 트랜잭션 정보 저장
    await saveJWSTransactionToFirestore(userId, transaction);

    console.log("✅ [Apple Best Practice] 구매 정보 동기화 완료:", {
      transactionId: transaction.transactionId,
      originalTransactionId: transaction.originalTransactionId,
      productId: transaction.productId,
    });

    return {
      success: true,
      transaction: {
        transactionId: transaction.transactionId,
        originalTransactionId: transaction.originalTransactionId,
        productId: transaction.productId,
        expiresDate: transaction.expiresDate,
        offerType: transaction.offerType,
        purchaseDate: transaction.purchaseDate,
        appAccountToken: transaction.appAccountToken,
      },
      dataSource: "jws-only",
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
 * 💾 JWS 트랜잭션 정보만 Firestore에 저장 (단순화)
 * @param {string} userId - 사용자 ID
 * @param {object} transaction - JWS 디코딩된 트랜잭션 정보
 */
async function saveJWSTransactionToFirestore(userId, transaction) {
  try {
    console.log("💾 JWS 트랜잭션 정보 Firestore 저장 시작 (단순화)");

    const db = admin.firestore();
    
    // 🎯 기본 트랜잭션 정보만 저장
    const basicTransactionData = {
      // 트랜잭션 ID 정보
      originalTransactionId: transaction.originalTransactionId,
      lastTransactionId: transaction.transactionId,
      
      // 제품 정보
      productId: transaction.productId,
      offerType: transaction.offerType,
      
      // 시간 정보
      purchaseDate: transaction.purchaseDate ? parseInt(transaction.purchaseDate) : null,
      expiresDate: transaction.expiresDate ? parseInt(transaction.expiresDate) : null,
      
      // 메타데이터
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdateSource: "syncPurchaseInfo",
      dataSource: "jws-only",
      
      // 🎯 appAccountToken 저장 (있는 경우)
      ...(transaction.appAccountToken && {
        appAccountToken: transaction.appAccountToken,
      }),
    };

    const updateData = {
      // 🎯 기본 트랜잭션 정보 저장
      lastTransactionInfo: basicTransactionData,
      
      // 🎯 기존 subscriptionData 구조도 업데이트 (호환성)
      subscriptionData: {
        ...basicTransactionData,
        // 상태 정보는 checkSubscriptionStatus에서 채움
      },
      
      lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSyncMethod: "jwsRepresentation",
    };

    await db.collection("users").doc(userId).set(updateData, {merge: true});

    console.log("✅ JWS 트랜잭션 정보 저장 완료:", {
      userId: userId,
      transactionId: transaction.transactionId,
      originalTransactionId: transaction.originalTransactionId,
      productId: transaction.productId,
      offerType: transaction.offerType,
    });
  } catch (error) {
    console.error("❌ JWS 트랜잭션 정보 저장 실패:", error.message);
    throw error;
  }
}



module.exports = {
  syncPurchaseInfo,
};
 