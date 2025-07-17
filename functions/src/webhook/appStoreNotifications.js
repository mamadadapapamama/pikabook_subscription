// Firebase Functions v2 - App Store Server Notifications 웹훅
const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const {Entitlement, SubscriptionStatus} = require("../shared/constant");
const {
  appstoreKeyId,
  appstoreIssuerId,
  appstorePrivateKey,
  appstoreBundleId,
  appstoreEnvironment,
  appStoreServerClient,
} = require("../utils/appStoreServerClient");

// 🎯 디버그 모드 설정
const kDebugMode = process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true';

/**
 * 🔥 App Store Server Notifications 웹훅 엔드포인트
 */
exports.appStoreNotifications = onRequest({
  region: "asia-southeast1",
  secrets: [
    appstoreKeyId,
    appstoreIssuerId,
    appstorePrivateKey,
    appstoreBundleId,
    appstoreEnvironment,
  ],
  cors: false,
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

    // JWS 디코딩
    const decodedPayload = decodeJWS(notificationPayload.signedPayload);
    if (!decodedPayload) {
      return res.status(400).send("Invalid JWS");
    }

    const notificationType = decodedPayload.notificationType;
    const subtype = decodedPayload.subtype;
    const transactionInfo = decodedPayload.data?.signedTransactionInfo;

    if (!transactionInfo) {
      return res.status(400).send("Missing transaction info");
    }

    const decodedTransaction = decodeJWS(transactionInfo);
    if (!decodedTransaction) {
      return res.status(400).send("Invalid transaction info");
    }

    // Bundle ID 검증
    const bundleId = appstoreBundleId.value();
    if (decodedTransaction.bundleId !== bundleId) {
      console.error("❌ Bundle ID 불일치");
      return res.status(400).send("Bundle ID mismatch");
    }

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
 * JWS 디코딩
 */
function decodeJWS(jws) {
  try {
    const parts = jws.split(".");
    if (parts.length !== 3) return null;
    
    const payload = parts[1];
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    return JSON.parse(decoded);
  } catch (error) {
    console.error("JWS 디코딩 실패:", error);
    return null;
  }
}

/**
 * 알림 처리 (단순화)
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
    // History 분석
    const historyResult = await appStoreServerClient.getTransactionHistory(transaction.transactionId);
    
    if (!historyResult.success) {
      console.error("❌ History 조회 실패:", historyResult.error);
      await saveBasicWebhookInfo(db, userId, notificationType, subtype, transaction);
      return;
    }

    // 구독 상태 분석
    const subscriptionInfo = analyzeTransactionHistory(historyResult.data);

    // Firestore 업데이트
    await updateSubscriptionData(db, userId, subscriptionInfo, notificationType, subtype, transaction);

    console.log(`✅ 웹훅 처리 완료: ${userId}, entitlement: ${subscriptionInfo.entitlement}, hasUsedTrial: ${subscriptionInfo.hasUsedTrial}`);

  } catch (error) {
    console.error("💥 History 분석 실패:", error);
    await saveBasicWebhookInfo(db, userId, notificationType, subtype, transaction);
  }
}

/**
 * 사용자 찾기
 */
async function findUserByOriginalTransactionId(db, originalTransactionId) {
  // 새로운 구조 검색
  let usersQuery = await db.collection("users")
    .where("subscriptionData.originalTransactionId", "==", originalTransactionId)
    .limit(1)
    .get();

  // 기존 구조 검색
  if (usersQuery.empty) {
    usersQuery = await db.collection("users")
      .where("subscription.originalTransactionId", "==", originalTransactionId)
      .limit(1)
      .get();
  }

  return usersQuery.empty ? null : usersQuery.docs[0].id;
}

/**
 * Transaction History 분석 (단순화)
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
    const decodedTransaction = decodeJWS(signedTransaction);
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

/**
 * 구독 데이터 업데이트
 */
async function updateSubscriptionData(db, userId, subscriptionInfo, notificationType, subtype, transaction) {
  const webhookData = {
    ...subscriptionInfo,
    notificationType: notificationType,
    subtype: subtype || null,
    originalTransactionId: transaction.originalTransactionId,
    lastTransactionId: transaction.transactionId,
    productId: transaction.productId,
    offerType: transaction.offerType,
    purchaseDate: transaction.purchaseDate ? parseInt(transaction.purchaseDate) : null,
    expiresDate: transaction.expiresDate ? parseInt(transaction.expiresDate) : null,
    lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastUpdateSource: "appStoreNotifications",
    dataSource: "webhook-real-time",
  };

  await db.collection("users").doc(userId).update({
    subscriptionData: webhookData,
    lastWebhookNotification: {
      notificationType: notificationType,
      subtype: subtype,
      transactionId: transaction.transactionId,
      productId: transaction.productId,
      offerType: transaction.offerType,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * 기본 웹훅 정보만 저장
 */
async function saveBasicWebhookInfo(db, userId, notificationType, subtype, transaction) {
  const basicData = {
    originalTransactionId: transaction.originalTransactionId,
    lastTransactionId: transaction.transactionId,
    notificationType: notificationType,
    subtype: subtype || null,
    productId: transaction.productId,
    offerType: transaction.offerType,
    purchaseDate: transaction.purchaseDate ? parseInt(transaction.purchaseDate) : null,
    expiresDate: transaction.expiresDate ? parseInt(transaction.expiresDate) : null,
    lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastUpdateSource: "appStoreNotifications",
    dataSource: "webhook-basic",
  };

  await db.collection("users").doc(userId).update({
    lastWebhookNotification: basicData,
    "subscriptionData.lastTransactionId": transaction.transactionId,
    "subscriptionData.lastUpdatedAt": admin.firestore.FieldValue.serverTimestamp(),
    "subscriptionData.lastUpdateSource": "appStoreNotifications",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`✅ 기본 웹훅 정보 저장: ${userId}`);
}
