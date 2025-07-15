// Firebase Functions v2 - App Store Server Notifications 웹훅
const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const {appStoreServerClient} = require("../utils/appStoreServerClient");

// Secrets 정의 (기존과 동일)
const appstoreBundleId = defineSecret("APPSTORE_BUNDLE_ID");

/**
 * 🔥 App Store Server Notifications 웹훅 엔드포인트
 * Apple이 구독 상태 변경 시 실시간으로 POST 요청을 보내는 엔드포인트
 */
exports.appStoreNotifications = onRequest({
  region: "asia-southeast1",
  secrets: [appstoreBundleId],
  cors: false, // Apple 서버에서만 호출
}, async (req, res) => {
  try {
    console.log(
      "📡 App Store Server Notification 수신:",
      {
        method: req.method,
        headers: req.headers,
        body: req.body,
      },
    );

    // POST 요청만 허용
    if (req.method !== "POST") {
      console.error("❌ POST 요청만 허용됩니다");
      return res.status(405).send("Method Not Allowed");
    }

    // Content-Type 확인
    const contentType = req.get("Content-Type");
    if (!contentType || !contentType.includes("application/json")) {
      console.error("❌ Content-Type이 application/json이 아닙니다:", contentType);
      return res.status(400).send("Invalid Content-Type");
    }

    // JWS(JSON Web Signature) 페이로드 추출
    const notificationPayload = req.body;
    if (!notificationPayload.signedPayload) {
      console.error("❌ signedPayload가 없습니다");
      return res.status(400).send("Missing signedPayload");
    }

    // JWS 디코딩 (검증은 프로덕션에서 필요)
    const decodedPayload = decodeJWS(notificationPayload.signedPayload);

    if (!decodedPayload) {
      console.error("❌ JWS 디코딩 실패");
      return res.status(400).send("Invalid JWS");
    }

    console.log("✅ 디코딩된 알림:", JSON.stringify(decodedPayload, null, 2));

    // 알림 타입 확인
    const notificationType = decodedPayload.notificationType;
    const subtype = decodedPayload.subtype;

    console.log(`📢 알림 타입: ${notificationType}, 서브타입: ${subtype}`);

    // 거래 정보 추출
    const transactionInfo = decodedPayload.data?.signedTransactionInfo;
    const renewalInfo = decodedPayload.data?.signedRenewalInfo;

    if (!transactionInfo) {
      console.error("❌ 거래 정보가 없습니다");
      return res.status(400).send("Missing transaction info");
    }

    // 거래 정보 디코딩
    const decodedTransaction = decodeJWS(transactionInfo);
    const decodedRenewal =
      renewalInfo ? decodeJWS(renewalInfo) : null;

    if (!decodedTransaction) {
      console.error("❌ 거래 정보 디코딩 실패");
      return res.status(400).send("Invalid transaction info");
    }

    console.log("💳 거래 정보:", JSON.stringify(decodedTransaction, null, 2));
    if (decodedRenewal) {
      console.log("🔄 갱신 정보:", JSON.stringify(decodedRenewal, null, 2));
    }

    // Bundle ID 검증
    const bundleId = appstoreBundleId.value();
    if (decodedTransaction.bundleId !== bundleId) {
      console.error("❌ Bundle ID 불일치:", {
        expected: bundleId,
        received: decodedTransaction.bundleId,
      });
      return res.status(400).send("Bundle ID mismatch");
    }

    // Firestore 업데이트 처리
    await processNotification(
      notificationType,
      subtype,
      decodedTransaction,
      decodedRenewal,
    );

    console.log("✅ 알림 처리 완료");
    return res.status(200).send("OK");
  } catch (error) {
    console.error("💥 App Store 알림 처리 실패:", error);
    return res.status(500).send("Internal Server Error");
  }
});

/**
 * JWS(JSON Web Signature) 디코딩 (검증 없이)
 * 프로덕션에서는 Apple의 공개키로 서명 검증 필요
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

/**
 * 알림 타입별 Firestore 업데이트 처리
 * @param {string} notificationType - 알림 타입
 * @param {string} subtype - 서브타입
 * @param {Object} transaction - 거래 정보
 * @param {Object} renewal - 갱신 정보
 */
async function processNotification(
  notificationType,
  subtype,
  transaction,
  renewal,
) {
  const db = admin.firestore();
  const originalTransactionId = transaction.originalTransactionId;

  console.log(`🔄 처리 시작: ${notificationType} (${subtype})`);

  // 🔍 originalTransactionId로 사용자 찾기
  console.log(`🔍 originalTransactionId로 사용자 검색: ${originalTransactionId}`);

  // 🎯 새로운 구조 우선 검색
  let usersQuery = await db.collection("users")
    .where(
      "subscriptionData.originalTransactionId",
      "==",
      originalTransactionId,
    )
    .limit(1)
    .get();

  // 🔄 기존 구조 fallback 검색 (호환성)
  if (usersQuery.empty) {
    console.log("🔄 새로운 구조에서 사용자 없음, 기존 구조에서 재검색");
    usersQuery = await db.collection("users")
      .where(
        "subscription.originalTransactionId",
        "==",
        originalTransactionId,
      )
      .limit(1)
      .get();
  }

  if (usersQuery.empty) {
    console.log("❌ 해당 originalTransactionId를 가진 사용자를 찾을 수 없습니다:",
      originalTransactionId);
    console.log("💡 클라이언트에서 originalTransactionId가 올바르게 저장되었는지 확인 필요");
    return;
  }

  const userDoc = usersQuery.docs[0];
  const userId = userDoc.id;
  const userData = userDoc.data();

  console.log(`✅ originalTransactionId로 사용자 발견: ${userId}`);

  // 기존 구독 정보
  const currentSubscription = userData.subscription || {};

  // 업데이트할 구독 정보 준비
  let subscriptionUpdate = {
    ...currentSubscription,
    originalTransactionId: originalTransactionId,
    lastNotificationType: notificationType,
    lastNotificationSubtype: subtype,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  // 알림 타입별 처리
  switch (notificationType) {
  case "SUBSCRIBED":
    // 새 구독 시작
    subscriptionUpdate = {
      ...subscriptionUpdate,
      plan: determinePlanFromProduct(transaction.productId),
      status: "active",
      startDate: admin.firestore.Timestamp.fromMillis(
        parseInt(transaction.purchaseDate),
      ),
      expiryDate: admin.firestore.Timestamp.fromMillis(
        parseInt(transaction.expiresDate),
      ),
      autoRenewStatus:
        renewal ? renewal.autoRenewStatus === 1 : true,
      isCancelled: false,
      isFreeTrial: transaction.offerType === 1, // 1 = introductory offer
    };
    console.log("🎉 새 구독 활성화");
    break;

  case "DID_RENEW":
    // 구독 갱신
    subscriptionUpdate = {
      ...subscriptionUpdate,
      status: "active",
      expiryDate: admin.firestore.Timestamp.fromMillis(
        parseInt(transaction.expiresDate),
      ),
      autoRenewStatus:
        renewal ? renewal.autoRenewStatus === 1 : true,
      isCancelled: false,
    };
    console.log("🔄 구독 갱신됨");
    break;

  case "DID_CHANGE_RENEWAL_STATUS": {
    // 자동 갱신 상태 변경
    const autoRenewStatus =
      renewal ? renewal.autoRenewStatus === 1 : false;
    subscriptionUpdate = {
      ...subscriptionUpdate,
      autoRenewStatus: autoRenewStatus,
      isCancelled: !autoRenewStatus, // 자동 갱신 꺼짐 = 취소
    };
    console.log(
      `🔄 자동 갱신 상태 변경: ${autoRenewStatus ? "활성화" : "비활성화"}`,
    );
    break;
  }

  case "EXPIRED":
    // 구독 만료
    subscriptionUpdate = {
      ...subscriptionUpdate,
      status: "expired",
      autoRenewStatus: false,
      isCancelled: true,
    };
    console.log("⏰ 구독 만료됨");
    break;

  case "GRACE_PERIOD_EXPIRED":
    // 유예 기간 만료
    subscriptionUpdate = {
      ...subscriptionUpdate,
      status: "expired",
      autoRenewStatus: false,
      isCancelled: true,
    };
    console.log("⏰ 유예 기간 만료됨");
    break;

  case "REVOKE":
    // Apple에서 구독 취소 (환불 등)
    subscriptionUpdate = {
      ...subscriptionUpdate,
      status: "revoked",
      autoRenewStatus: false,
      isCancelled: true,
    };
    console.log("🚫 구독 취소됨 (Apple)");
    break;

  default:
    console.log(`ℹ️ 처리하지 않는 알림 타입: ${notificationType}`);
    return;
  }

  // Firestore 업데이트 (통합 구조)
  try {
    // 🎯 새로운 구조로 변환
    const cacheData = await convertToNewStructure(subscriptionUpdate, notificationType, subtype);

    // 🎯 통합 구독 데이터 구조 (간소화)
    const unifiedSubscriptionData = {
      ...cacheData,
      
      // 기본 정보
      originalTransactionId: originalTransactionId,
      lastTransactionId: transaction.transactionId,
      
      // 포맷 변환
      expirationDate: cacheData.expirationDate ?
        parseInt(cacheData.expirationDate) : null,
      
      // 메타데이터 (간소화)
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdateSource: "appStoreNotifications",
      dataSource: "webhook-real-time",
      
      // 🎯 디버깅용 (선택적)
      lastNotificationType: notificationType,
      lastNotificationSubtype: subtype,
    };

    await db.collection("users").doc(userId).update({
      // 🎯 통합 구독 데이터 (단일 구조)
      subscriptionData: unifiedSubscriptionData,
      
      // 메타데이터
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("✅ Firestore 업데이트 완료 (통합 구조):", {
      userId: userId,
      plan: subscriptionUpdate.plan,
      status: subscriptionUpdate.status,
      entitlement: cacheData.entitlement,
      subscriptionStatus: cacheData.subscriptionStatus,
      hasUsedTrial: cacheData.hasUsedTrial,
      autoRenewEnabled: cacheData.autoRenewEnabled,
      dataSource: "webhook-real-time",
    });
  } catch (error) {
    console.error("💥 Firestore 업데이트 실패:", error);
    throw error;
  }
}

/**
 * 🔍 전체 히스토리에서 trial 사용 여부 확인 (웹훅용)
 * @param {string} originalTransactionId - 원본 트랜잭션 ID
 * @return {Promise<boolean>} trial 사용 여부
 */
async function checkTrialUsageFromHistory(originalTransactionId) {
  try {
    console.log("🔍 [웹훅] 전체 히스토리에서 trial 사용 여부 확인:", originalTransactionId);

    // App Store Server API로 전체 히스토리 조회
    const historyResult = await appStoreServerClient.getTransactionHistory(originalTransactionId);
    
    if (!historyResult.success) {
      console.error("❌ 트랜잭션 히스토리 조회 실패:", historyResult.error);
      return false;
    }

    const transactions = historyResult.data.signedTransactions || [];
    console.log(`📋 [웹훅] 전체 트랜잭션 수: ${transactions.length}`);

    // 모든 트랜잭션을 확인하여 trial 사용 여부 체크
    for (const signedTransaction of transactions) {
      const decodedTransaction = decodeJWS(signedTransaction);
      
      if (!decodedTransaction.success) {
        continue;
      }

      const transactionData = decodedTransaction.data;
      const isFreeTrial = transactionData.offerType === 5; // Free Trial
      
      if (isFreeTrial) {
        console.log("✅ [웹훅] 히스토리에서 trial 사용 확인됨:", {
          transactionId: transactionData.transactionId,
          productId: transactionData.productId,
          offerType: transactionData.offerType,
        });
        return true;
      }
    }

    console.log("❌ [웹훅] 히스토리에서 trial 사용 확인되지 않음");
    return false;
  } catch (error) {
    console.error("❌ [웹훅] 히스토리 trial 확인 중 오류:", error.message);
    return false;
  }
}

/**
 * 🎯 기존 구조를 새로운 캐시 구조로 변환 (간소화)
 * @param {object} subscriptionUpdate - 기존 구독 업데이트 정보
 * @param {string} notificationType - 알림 타입
 * @param {string} subtype - 알림 서브타입
 * @return {object} 새로운 구조의 캐시 데이터
 */
async function convertToNewStructure(subscriptionUpdate, notificationType, subtype) {
  const {Entitlement, SubscriptionStatus} = require("../shared/constant");

  // 기본값 설정
  const result = {
    entitlement: Entitlement.FREE,
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    hasUsedTrial: false, // 히스토리 조회 후 설정
    autoRenewEnabled: subscriptionUpdate.autoRenewStatus || false,
    subscriptionType: subscriptionUpdate.plan === "premium" ? "monthly" : "monthly",
    expirationDate: subscriptionUpdate.expiryDate?.toMillis()?.toString() || null,
  };

  // 🔍 전체 히스토리에서 trial 사용 여부 확인
  if (subscriptionUpdate.originalTransactionId) {
    result.hasUsedTrial = await checkTrialUsageFromHistory(subscriptionUpdate.originalTransactionId);
  }

  // 🎯 Entitlement 결정
  const now = Date.now();
  const expiryTime = subscriptionUpdate.expiryDate?.toMillis() || 0;
  const isExpired = expiryTime > 0 && expiryTime < now;

  if (!isExpired && subscriptionUpdate.status === "active") {
    if (subscriptionUpdate.isFreeTrial) {
      result.entitlement = Entitlement.TRIAL;
    } else if (subscriptionUpdate.plan === "premium") {
      result.entitlement = Entitlement.PREMIUM;
    }
  }

  // 🎯 SubscriptionStatus 결정
  if (subscriptionUpdate.status === "revoked") {
    result.subscriptionStatus = SubscriptionStatus.REFUNDED;
    result.entitlement = Entitlement.FREE;
  } else if (subscriptionUpdate.status === "expired") {
    result.subscriptionStatus = SubscriptionStatus.EXPIRED;
    result.entitlement = Entitlement.FREE;
  } else if (subscriptionUpdate.isCancelled && subscriptionUpdate.status === "active") {
    result.subscriptionStatus = SubscriptionStatus.CANCELLING;
    // 🎯 취소했지만 아직 유효하면 entitlement 유지
  } else if (subscriptionUpdate.status === "active") {
    result.subscriptionStatus = SubscriptionStatus.ACTIVE;
  }

  // 🎯 특별한 알림 타입별 처리
  if (notificationType === "SUBSCRIBED") {
    result.subscriptionStatus = SubscriptionStatus.ACTIVE;
  } else if (notificationType === "DID_CHANGE_RENEWAL_STATUS") {
    // 🎯 사용자가 구독 취소 → autoRenewEnabled = false
    if (subscriptionUpdate.autoRenewStatus) {
      result.subscriptionStatus = SubscriptionStatus.ACTIVE;
    } else {
      result.subscriptionStatus = SubscriptionStatus.CANCELLING;
    }
  } else if (notificationType === "EXPIRED") {
    result.subscriptionStatus = SubscriptionStatus.EXPIRED;
    result.entitlement = Entitlement.FREE;
  } else if (notificationType === "REFUND") {
    result.subscriptionStatus = SubscriptionStatus.REFUNDED;
    result.entitlement = Entitlement.FREE;
  }

  console.log("🎯 웹훅 데이터 변환 완료:", {
    notificationType: notificationType,
    subtype: subtype,
    entitlement: result.entitlement,
    subscriptionStatus: result.subscriptionStatus,
    autoRenewEnabled: result.autoRenewEnabled,
    hasUsedTrial: result.hasUsedTrial,
  });

  return result;
}

/**
 * 제품 ID에서 플랜 결정
 * @param {string} productId - 제품 ID
 * @return {string} 플랜 타입
 */
function determinePlanFromProduct(productId) {
  if (productId.includes("monthly")) {
    return "premium";
  } else if (productId.includes("yearly")) {
    return "premium";
  } else if (productId.includes("trial")) {
    return "premium"; // 체험도 프리미엄 기능 사용
  }
  return "free";
}
