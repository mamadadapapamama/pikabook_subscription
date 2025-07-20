// Firebase Functions v2 - App Store Server Notifications 웹훅
const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const {Entitlement, SubscriptionStatus} = require("../shared/constant");
const {updateUnifiedSubscriptionData} =
  require("../utils/subscriptionDataManager");
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

// 🎯 디버그 모드 설정
const kDebugMode = process.env.NODE_ENV === "development" || process.env.DEBUG === "true";

/**
 * 💡 최신 트랜잭션 정보만으로 상태 업데이트가 충분한 알림 유형들
 * 이 경우 getTransactionHistory() API 호출을 생략하여 비용과 시간을 절약합니다.
 */
const SIMPLE_UPDATE_NOTIFICATIONS = [
  "SUBSCRIBED",
  "DID_RENEW",
  "DID_CHANGE_RENEWAL_STATUS",
  "PRICE_INCREASE",
];

/**
 * 🔥 App Store Server Notifications 웹훅 엔드포인트
 */
// ⭐️ 수정: Secret Manager의 비밀들을 함수 dependency로 선언합니다.
exports.appStoreNotifications = onRequest({
  region: "asia-southeast1",
  cors: false,
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
}, async (req, res) => {
  try {
    console.log("📡 App Store 웹훅 알림 수신:", req.method);

    // 기본 검증
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const notificationPayload = req.body;
    if (!notificationPayload.signedPayload) {
      return res.status(400).send("Missing signedPayload");
    }

    // ⭐️ 수정: `iapClient`를 사용하여 JWS 검증 및 디코딩
    const verificationResult = await iapClient.verifySignedPayload(notificationPayload.signedPayload);

    if (!verificationResult.success) {
      console.error("❌ 웹훅 JWS 검증 실패:", verificationResult.error);
      return res.status(401).send("Invalid JWS signature");
    }
    const decodedPayload = verificationResult.data;

    const notificationType = decodedPayload.notificationType;
    const subtype = decodedPayload.subtype;
    const signedTransactionInfo = decodedPayload.data?.signedTransactionInfo;

    if (!signedTransactionInfo) {
      console.warn("✅ 알림에 트랜잭션 정보가 없습니다. (예: TEST 알림). 처리를 종료합니다.", {notificationType, subtype});
      return res.status(200).send("OK. No transaction info.");
    }

    // ⭐️ 수정: `iapClient`를 사용하여 트랜잭션 JWS 검증
    const transactionVerificationResult = await iapClient.verifyJWS(signedTransactionInfo);
    if (!transactionVerificationResult.success) {
      console.error("❌ 트랜잭션 JWS 검증 실패:", transactionVerificationResult.error);
      return res.status(401).send("Invalid transaction JWS signature");
    }
    const decodedTransaction = transactionVerificationResult.data;

    // Bundle ID 검증은 iapClient 내부에서 이미 처리됩니다.

    console.log(`📢 처리: ${notificationType} (${subtype}), 제품: ${decodedTransaction.productId}`);

    // 알림 처리
    await processNotification(notificationType, subtype, decodedTransaction);

    return res.status(200).send("OK");
  } catch (error) {
    console.error("💥 웹훅 처리 실패:", error);
    return res.status(500).send("Internal Server Error");
  }
});

/**
 * 알림 처리 (통합 함수 사용)
 */
async function processNotification(notificationType, subtype, transaction) {
  const db = admin.firestore();
  const originalTransactionId = transaction.originalTransactionId;

  // 사용자 찾기
  const userId = await findUserByOriginalTransactionId(db, originalTransactionId);
  if (!userId) {
    console.log("❌ 사용자를 찾을 수 없음:", originalTransactionId);
    return;
  }

  console.log(`✅ 사용자 발견: ${userId}`);

  try {
    let subscriptionInfo;

    // 💡 최적화: 단순 알림은 History 조회 생략
    if (SIMPLE_UPDATE_NOTIFICATIONS.includes(notificationType)) {
      console.log("⚡️ 단순 알림: getTransactionHistory() 호출 생략");
      subscriptionInfo = createSubscriptionInfoFromTransaction(transaction);
    } else {
      //  복잡한 알림은 History 조회
      console.log("📚 복잡한 알림: getTransactionHistory() 호출");
      // ⭐️ 수정: `iapClient` 사용
      const historyResult = await iapClient.getTransactionHistory(transaction.originalTransactionId);

      if (!historyResult.success) {
        console.error("❌ History 조회 실패:", historyResult.error);
        await saveBasicWebhookInfo(db, userId, notificationType, subtype, transaction);
        return;
      }
      subscriptionInfo = analyzeTransactionHistory(historyResult.data);
    }

    // 통합 구독 데이터 업데이트
    const subscriptionUpdates = {
      ...subscriptionInfo,
      lastTransactionId: transaction.transactionId,
      originalTransactionId: transaction.originalTransactionId,
      productId: transaction.productId,
      purchaseDate: transaction.purchaseDate ? parseInt(transaction.purchaseDate) : null,
      notificationType: notificationType,

      // 조건부 필드들
      ...(subtype && {notificationSubtype: subtype}),
      ...(transaction.offerType && {offerType: transaction.offerType}),
    };

    await updateUnifiedSubscriptionData(db, userId, subscriptionUpdates, "webhook");

    console.log(`✅ 웹훅 처리 완료: ${userId}, entitlement: ${subscriptionInfo.entitlement}, hasUsedTrial: ${subscriptionInfo.hasUsedTrial}`);
  } catch (error) {
    console.error("💥 알림 처리 실패:", error);
    await saveBasicWebhookInfo(db, userId, notificationType, subtype, transaction);
  }
}

/**
 * 기본 웹훅 정보 저장 (History 조회 실패 시)
 */
async function saveBasicWebhookInfo(db, userId, notificationType, subtype, transaction) {
  try {
    const basicSubscriptionUpdates = {
      originalTransactionId: transaction.originalTransactionId,
      lastTransactionId: transaction.transactionId,
      productId: transaction.productId,
      purchaseDate: transaction.purchaseDate ? parseInt(transaction.purchaseDate) : null,
      expiresDate: transaction.expiresDate ? parseInt(transaction.expiresDate) : null,
      notificationType: notificationType,

      // 조건부 필드들
      ...(subtype && {notificationSubtype: subtype}),
      ...(transaction.offerType && {offerType: transaction.offerType}),
    };

    await updateUnifiedSubscriptionData(db, userId, basicSubscriptionUpdates, "webhook");

    console.log(`✅ 기본 웹훅 정보 저장: ${userId}`);
  } catch (error) {
    console.error("❌ 기본 웹훅 정보 저장 실패:", error);
    throw error;
  }
}

/**
 * 사용자 찾기
 */
async function findUserByOriginalTransactionId(db, originalTransactionId) {
  // 통합 구조 검색
  let usersQuery = await db.collection("users")
    .where("subscriptionData.originalTransactionId", "==", originalTransactionId)
    .limit(1)
    .get();

  // 레거시 구조 검색 (호환성)
  if (usersQuery.empty) {
    usersQuery = await db.collection("users")
      .where("subscription.originalTransactionId", "==", originalTransactionId)
      .limit(1)
      .get();
  }

  return usersQuery.empty ? null : usersQuery.docs[0].id;
}

/**
 * 💡 단일 트랜잭션 정보로 구독 상태 객체를 생성하는 함수
 * @param {object} transaction - 디코딩된 트랜잭션 정보
 * @return {object} - 구독 정보 객체
 */
function createSubscriptionInfoFromTransaction(transaction) {
  const result = {
    entitlement: Entitlement.FREE,
    subscriptionStatus: SubscriptionStatus.EXPIRED,
    autoRenewEnabled: false,
    subscriptionType: null,
    expirationDate: null,
  };

  const now = Date.now();
  const expiresDate = parseInt(transaction.expiresDate) || 0;
  const isExpired = expiresDate > 0 && expiresDate < now;
  const isRevoked = !!transaction.revocationDate;

  result.expirationDate = expiresDate.toString();

  if (isRevoked) {
    result.entitlement = Entitlement.FREE;
    result.subscriptionStatus = SubscriptionStatus.REFUNDED;
  } else if (isExpired) {
    result.entitlement = Entitlement.FREE;
    result.subscriptionStatus = SubscriptionStatus.EXPIRED;
  } else {
    result.entitlement = Entitlement.PREMIUM;
    result.subscriptionStatus = SubscriptionStatus.ACTIVE;
    result.autoRenewEnabled = true; // 만료되지 않았으므로 자동 갱신 중으로 간주
  }

  // 구독 타입 결정
  if (transaction.productId?.includes("yearly")) {
    result.subscriptionType = "yearly";
  } else if (transaction.productId?.includes("monthly")) {
    result.subscriptionType = "monthly";
  }

  console.log("📦 단일 트랜잭션으로 구독 정보 생성:", {
    entitlement: result.entitlement,
    status: result.subscriptionStatus,
  });

  return result;
}


/**
 * Transaction History 분석 (기존 로직 유지)
 */
function analyzeTransactionHistory(historyData) {
  const result = {
    entitlement: Entitlement.FREE,
    subscriptionStatus: SubscriptionStatus.NEVER_SUBSCRIBED,
    hasUsedTrial: false,
    autoRenewEnabled: false,
    subscriptionType: null,
    expirationDate: null,
    hasFamilySharedSubscription: false,
    environment: null,
    subscriptionStartDate: null,
  };

  const transactions = historyData.signedTransactions || [];
  if (transactions.length === 0) return result;

  let latestTransaction = null;
  let latestExpirationDate = 0;

  // 모든 트랜잭션 분석
  for (const signedTransaction of transactions) {
    const decodedTransaction = iapClient.decodeJWS(signedTransaction);
    if (!decodedTransaction) continue;

    const offerType = decodedTransaction.offerType;
    const expiresDate = parseInt(decodedTransaction.expiresDate) || 0;

    // Trial 사용 여부 확인
    if (offerType === 1) {
      result.hasUsedTrial = true;
      if (kDebugMode) {
        console.log(`🎯 Trial 트랜잭션 발견: ${decodedTransaction.productId}`);
      }
    }

    // 최신 트랜잭션 찾기
    if (expiresDate > latestExpirationDate) {
      latestExpirationDate = expiresDate;
      latestTransaction = decodedTransaction;
    }

    // 구독 타입 결정
    if (decodedTransaction.productId?.includes("yearly")) {
      result.subscriptionType = "yearly";
    } else if (decodedTransaction.productId?.includes("monthly")) {
      result.subscriptionType = "monthly";
    }

    // 추가 정보
    if (decodedTransaction.inAppOwnershipType === "FAMILY_SHARED") {
      result.hasFamilySharedSubscription = true;
    }
    if (decodedTransaction.environment) {
      result.environment = decodedTransaction.environment;
    }
    if (decodedTransaction.originalPurchaseDate) {
      const startDate = parseInt(decodedTransaction.originalPurchaseDate);
      if (!result.subscriptionStartDate || startDate < result.subscriptionStartDate) {
        result.subscriptionStartDate = startDate.toString();
      }
    }
  }

  // 현재 상태 결정
  if (latestTransaction) {
    const now = Date.now();
    const expiresDate = parseInt(latestTransaction.expiresDate) || 0;
    const isExpired = expiresDate > 0 && expiresDate < now;
    const isRevoked = !!latestTransaction.revocationDate;
    const isCurrentTransactionTrial = latestTransaction.offerType === 1;

    result.expirationDate = expiresDate.toString();

    if (isRevoked) {
      result.entitlement = Entitlement.FREE;
      result.subscriptionStatus = SubscriptionStatus.REFUNDED;
    } else if (isExpired) {
      result.entitlement = Entitlement.FREE;
      result.subscriptionStatus = SubscriptionStatus.EXPIRED;
    } else {
      if (isCurrentTransactionTrial) {
        result.entitlement = Entitlement.TRIAL;
        result.subscriptionStatus = SubscriptionStatus.ACTIVE;
      } else {
        result.entitlement = Entitlement.PREMIUM;
        result.subscriptionStatus = SubscriptionStatus.ACTIVE;
      }
      result.autoRenewEnabled = true;
    }
  }

  return result;
}
