// 📁 functions/src/subscription/syncPurchaseInfo.js
// 🚀 Apple Best Practice: jwsRepresentation 기반 구매 정보 동기화
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const {SubscriptionStatus} = require("../shared/constant");
const {checkInternalTestAccount} = require("../utils/testAccounts");
// ⭐️ 수정: `iapClient` 싱글톤 인스턴스를 가져옵니다.
const {iapClient} = require("../utils/appStoreServerClient");

// Secret Manager에서 환경 변수 정의
const iapKeyId = defineSecret("APP_STORE_KEY_ID");
const iapIssuerId = defineSecret("APP_STORE_ISSUER_ID");
const iapBundleId = defineSecret("APP_STORE_BUNDLE_ID");
const iapPrivateKeyBase64 = defineSecret("APP_STORE_PRIVATE_KEY_BASE64");
const iapEnvironment = defineSecret("APP_STORE_ENVIRONMENT");
const appleRootCert1 = defineSecret("APPLE_ROOT_CA_G1_BASE64");
const appleRootCert2 = defineSecret("APPLE_ROOT_CA_G2_BASE64");
const appleRootCert3 = defineSecret("APPLE_ROOT_CA_G3_BASE64");
const {updateUnifiedSubscriptionData} =
  require("../utils/subscriptionDataManager");

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
// ⭐️ 수정: Secret Manager의 비밀들을 함수 dependency로 선언합니다.
const syncPurchaseInfo = onCall({
  region: "asia-southeast1",
  secrets: [
    iapKeyId,
    iapIssuerId,
    iapBundleId,
    iapPrivateKeyBase64,
    iapEnvironment,
    appleRootCert1,
    appleRootCert2,
    appleRootCert3,
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
        version: "jwsRepresentation-v3",
      };
    }

    // 🎯 Step 2: JWS 직접 검증 및 트랜잭션 정보 추출
    // ⭐️ 수정: `iapClient` 인스턴스의 `verifyJWS` 메서드를 호출합니다.
    const transactionInfo = await iapClient.verifyJWS(jwsRepresentation);

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

    // 🎯 Step 3: 구독 정보 해석 및 상태 결정
    const {
      productId,
      expiresDate,
      purchaseDate,
      offerType,
      transactionId,
      originalTransactionId,
      appAccountToken,
      revocationDate,
      isUpgraded,
    } = transaction;

    let entitlement = "FREE";
    let subscriptionType = "none";

    // Product ID 기반으로 구독 유형 및 권한 결정
    if (productId.includes("monthly")) {
      subscriptionType = "monthly";
      entitlement = "PREMIUM";
    } else if (productId.includes("yearly")) {
      subscriptionType = "yearly";
      entitlement = "PREMIUM";
    }

    // 최종 구독 상태 결정
    const expiresDateMs = expiresDate ? parseInt(expiresDate) : 0;
    const isExpired = expiresDateMs <= Date.now();
    let subscriptionStatus = "EXPIRED";

    if (revocationDate) {
      subscriptionStatus = "REVOKED";
      entitlement = "FREE";
    } else if (!isExpired) {
      subscriptionStatus = "ACTIVE";
    } else {
      subscriptionStatus = "EXPIRED";
      entitlement = "FREE";
    }

    // 이 트랜잭션이 무료 체험이었는지 확인.
    // isUpgraded가 true이면 이미 구독 경험이 있으므로 신규 체험이 아님.
    const isTrialTransaction = offerType === 1 && !isUpgraded;
    if (isTrialTransaction) {
      entitlement = "PREMIUM"; // 체험도 프리미엄 권한 부여
    }

    // Firestore에 저장할 데이터 준비
    const db = admin.firestore();
    const subscriptionUpdates = {
      originalTransactionId,
      lastTransactionId: transactionId,
      productId,
      purchaseDate: purchaseDate ? parseInt(purchaseDate) : null,
      expiresDate: expiresDateMs,
      entitlement,
      subscriptionStatus: SubscriptionStatus[subscriptionStatus], // "ACTIVE" -> 1
      subscriptionType,
      // isTrialTransaction이 true일 때만 hasUsedTrial을 true로 설정 (덮어쓰지 않음)
      ...(isTrialTransaction && {hasUsedTrial: true}),
      ...(offerType && {offerType}),
      ...(appAccountToken && {appAccountToken}),
      ...(revocationDate && {revocationDate: parseInt(revocationDate)}),
    };

    // Firestore 업데이트
    await updateUnifiedSubscriptionData(db, userId, subscriptionUpdates, "syncPurchaseInfo");

    // 🔥 Step 5: 클라이언트에 반환할 최종 응답 단순화
    const finalResponse = {
      success: true,
      entitlement,
      subscriptionStatus: SubscriptionStatus[subscriptionStatus], // "ACTIVE" -> 1
      expiresDate: expiresDateMs,
      productId,
      dataSource: "jws-simplified", // 데이터 출처 명시
      timestamp: new Date().toISOString(),
    };

    console.log("✅ [Apple Best Practice] 최종 응답 준비 완료:", finalResponse);

    return finalResponse;
  } catch (error) {
    console.error("❌ [Error] 구매 정보 동기화 실패:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError("internal", "Internal server error: " + error.message);
  }
});

module.exports = {
  syncPurchaseInfo,
};
