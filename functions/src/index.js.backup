// Firebase Functions v2 with Secrets Manager
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const jwt = require("jsonwebtoken");
const axios = require("axios");

// 글로벌 설정
setGlobalOptions({
  maxInstances: 10,
  memory: "256MiB",
  timeoutSeconds: 60,
  region: "us-central1",
});

// Secrets 정의
const appstoreKeyId = defineSecret("APPSTORE_KEY_ID");
const appstoreIssuerId = defineSecret("APPSTORE_ISSUER_ID");
const appstoreBundleId = defineSecret("APPSTORE_BUNDLE_ID");
const appstorePrivateKey = defineSecret("APPSTORE_PRIVATE_KEY");

// Firebase Admin 초기화
admin.initializeApp();

// API URLs
const APP_STORE_SERVER_API_URL = "https://api.storekit.itunes.apple.com";
const APP_STORE_VALIDATION_URL = "https://buy.itunes.apple.com/verifyReceipt";
const APP_STORE_SANDBOX_URL = "https://sandbox.itunes.apple.com/verifyReceipt";

/**
 * 🔥 간단한 테스트 함수 (Firebase v2)
 */
exports.test_simple = onCall(async (request) => {
  console.log("=== test_simple v2 함수 시작 ===");
  console.log("받은 데이터:", request.data);

  try {
    return {
      success: true,
      message: "✅ Firebase Functions v2 테스트 성공!",
      timestamp: new Date().toISOString(),
      receivedData: request.data,
      version: "v2",
      serverTime: new Date().toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
      }),
    };
  } catch (error) {
    console.error("test_simple 오류:", error);
    return {
      success: false,
      error: error.message,
    };
  }
});

/**
 * 🔥 인증 테스트 함수 (Firebase v2)
 */
exports.test_auth = onCall(async (request) => {
  console.log("=== test_auth v2 함수 시작 ===");
  console.log("받은 데이터:", request.data);
  console.log("인증 정보:", request.auth);

  try {
    // 인증 확인
    if (!request.auth) {
      return {
        success: false,
        message: "❌ 인증이 필요합니다",
        authRequired: true,
      };
    }

    return {
      success: true,
      message: "✅ 인증 테스트 성공!",
      timestamp: new Date().toISOString(),
      receivedData: request.data,
      authInfo: {
        uid: request.auth.uid,
        email: request.auth.token?.email || "이메일 없음",
      },
      version: "v2",
    };
  } catch (error) {
    console.error("test_auth 오류:", error);
    return {
      success: false,
      error: error.message,
    };
  }
});

/**
 * 🔥 환경 변수 테스트 함수 (Firebase v2 with Secrets)
 */
exports.test_config = onCall({
  secrets: [
    appstoreKeyId,
    appstoreIssuerId,
    appstoreBundleId,
    appstorePrivateKey,
  ],
}, async (request) => {
  console.log("=== test_config v2 함수 시작 ===");

  try {
    // Secrets Manager 방식으로 확인
    const configStatus = {
      key_id: appstoreKeyId.value() ? "✅ 설정됨" : "❌ 미설정",
      issuer_id: appstoreIssuerId.value() ? "✅ 설정됨" : "❌ 미설정",
      bundle_id: appstoreBundleId.value() ? "✅ 설정됨" : "❌ 미설정",
      private_key: appstorePrivateKey.value() ? "✅ 설정됨" : "❌ 미설정",
    };

    const allConfigured = Object.values(configStatus).every(
      (status) => status.includes("✅"),
    );

    return {
      success: true,
      message: allConfigured ?
        "✅ 모든 환경 변수 설정 완료!" :
        "⚠️ 일부 환경 변수 미설정",
      configStatus: configStatus,
      allConfigured: allConfigured,
      timestamp: new Date().toISOString(),
      version: "v2",
      secretsMethod: "Firebase Secrets Manager",
    };
  } catch (error) {
    console.error("test_config 오류:", error);
    return {
      success: false,
      error: error.message,
    };
  }
});

/**
 * 🔥 Firestore 테스트 함수 (Firebase v2)
 */
exports.test_firestore = onCall(async (request) => {
  console.log("=== test_firestore v2 함수 시작 ===");

  try {
    // 인증 확인
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "User must be authenticated",
      );
    }

    const db = admin.firestore();
    const testDoc = db.collection("test").doc("connection_v2");

    // 테스트 데이터 쓰기
    await testDoc.set({
      message: "Firestore 연결 테스트 (v2)",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userId: request.auth.uid,
      version: "v2",
    });

    // 테스트 데이터 읽기
    const doc = await testDoc.get();
    const docData = doc.data();

    return {
      success: true,
      message: "✅ Firestore 연결 테스트 성공!",
      testData: docData,
      userId: request.auth.uid,
      version: "v2",
    };
  } catch (error) {
    console.error("test_firestore 오류:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      "Firestore 테스트 실패: " + error.message,
    );
  }
});

/**
 * JWT 토큰 생성 함수 (App Store Server API용)
 * @return {string} JWT 토큰
 */
function generateServerJWT() {
  const keyId = appstoreKeyId.value();
  const issuerId = appstoreIssuerId.value();
  const privateKey = appstorePrivateKey.value();
  const bundleId = appstoreBundleId.value();

  if (!keyId || !issuerId || !privateKey || !bundleId) {
    throw new Error("App Store Server API 환경 변수가 설정되지 않았습니다");
  }

  const now = Math.floor(Date.now() / 1000);

  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + 3600, // 1시간 후 만료
    aud: "appstoreconnect-v1",
    bid: bundleId,
  };

  const header = {
    alg: "ES256",
    kid: keyId,
    typ: "JWT",
  };

  return jwt.sign(payload, privateKey, {
    algorithm: "ES256",
    header: header,
  });
}

/**
 * 플랜 유형 판별 헬퍼 함수
 * @param {string} productId 제품 ID
 * @return {string} 플랜 타입
 */
function determinePlanType(productId) {
  if (productId.includes("trial") || productId.includes("free_trial")) {
    return "trial"; // 체험 (월구독 프리미엄 7일 무료체험)
  } else if (productId.includes("monthly") ||
             productId.includes("premium_monthly")) {
    return "premium_monthly"; // 프리미엄 (월구독)
  } else if (productId.includes("yearly") ||
             productId.includes("premium_yearly")) {
    return "premium_yearly"; // 프리미엄 (연구독)
  } else {
    return "free"; // 무료 (적은 사용량)
  }
}

/**
 * 🔥 구독 상태 조회 함수 (Firebase v2 with Secrets)
 */
exports.sub_getAllSubscriptionStatuses = onCall({
  secrets: [
    appstoreKeyId,
    appstoreIssuerId,
    appstorePrivateKey,
    appstoreBundleId,
  ],
}, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "User must be authenticated",
      );
    }

    const {originalTransactionId} = request.data;

    if (!originalTransactionId) {
      throw new HttpsError(
        "invalid-argument",
        "originalTransactionId is required",
      );
    }

    const token = generateServerJWT();

    const apiUrl = APP_STORE_SERVER_API_URL +
      "/inApps/v1/subscriptions/" + originalTransactionId;

    const response = await axios.get(apiUrl, {
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    const subscriptionData = response.data;

    // 구독 상태 분석
    const subscriptionStatuses = subscriptionData.data || [];
    let currentPlan = "free";
    let isActive = false;
    let expirationDate = null;
    let autoRenewStatus = false;

    // 활성 구독 찾기
    for (const subscription of subscriptionStatuses) {
      const lastTransaction = subscription.lastTransactions?.[0];
      if (!lastTransaction) continue;

      const status = lastTransaction.status;

      if (status === 1) { // Active
        isActive = true;
        expirationDate = lastTransaction.expiresDate;
        autoRenewStatus = lastTransaction.autoRenewStatus === 1;
        currentPlan = determinePlanType(lastTransaction.productId);
        break;
      } else if (status === 4) { // Billing Grace Period
        isActive = true;
        currentPlan = determinePlanType(lastTransaction.productId);
        break;
      }
    }

    return {
      success: true,
      subscription: {
        isActive: isActive,
        currentPlan: currentPlan,
        expirationDate: expirationDate,
        autoRenewStatus: autoRenewStatus,
        subscriptionStatuses: subscriptionStatuses,
      },
      version: "v2",
    };
  } catch (error) {
    console.error("Error getting subscription statuses:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      "Failed to get subscription statuses",
    );
  }
});

/**
 * 🔥 거래 정보 조회 함수 (Firebase v2 with Secrets)
 */
exports.sub_getTransactionInfo = onCall({
  secrets: [
    appstoreKeyId,
    appstoreIssuerId,
    appstorePrivateKey,
    appstoreBundleId,
  ],
}, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "User must be authenticated",
      );
    }

    const {transactionId} = request.data;

    if (!transactionId) {
      throw new HttpsError(
        "invalid-argument",
        "transactionId is required",
      );
    }

    const token = generateServerJWT();

    const apiUrl = APP_STORE_SERVER_API_URL +
      "/inApps/v1/transactions/" + transactionId;

    const response = await axios.get(apiUrl, {
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    return {
      success: true,
      transaction: response.data,
      version: "v2",
    };
  } catch (error) {
    console.error("Error getting transaction info:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      "Failed to get transaction info",
    );
  }
});

/**
 * 🔥 통합 구독 상태 확인 함수 (Firebase v2 with Secrets)
 */
exports.sub_checkSubscriptionStatus = onCall({
  secrets: [
    appstoreKeyId,
    appstoreIssuerId,
    appstorePrivateKey,
    appstoreBundleId,
  ],
}, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "User must be authenticated",
      );
    }

    let {originalTransactionId} = request.data;
    const userId = request.auth.uid;

    if (!originalTransactionId) {
      // Firestore에서 사용자의 마지막 거래 ID 조회
      const db = admin.firestore();
      const userDoc = await db.collection("users").doc(userId).get();

      const userData = userDoc.data();
      const hasTransactionId = userData?.subscription?.originalTransactionId;
      if (!userDoc.exists || !hasTransactionId) {
        return {
          success: true,
          subscription: {
            isActive: false,
            currentPlan: "free",
          },
          version: "v2",
        };
      }

      originalTransactionId = userData.subscription.originalTransactionId;
    }

    // getAllSubscriptionStatuses 로직 재사용
    const token = generateServerJWT();

    const apiUrl = APP_STORE_SERVER_API_URL +
      "/inApps/v1/subscriptions/" + originalTransactionId;

    const response = await axios.get(apiUrl, {
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    const subscriptionData = response.data;

    // 구독 상태 분석
    const subscriptionStatuses = subscriptionData.data || [];
    let currentPlan = "free";
    let isActive = false;
    let expirationDate = null;
    let autoRenewStatus = false;

    // 활성 구독 찾기
    for (const subscription of subscriptionStatuses) {
      const lastTransaction = subscription.lastTransactions?.[0];
      if (!lastTransaction) continue;

      const status = lastTransaction.status;

      if (status === 1) { // Active
        isActive = true;
        expirationDate = lastTransaction.expiresDate;
        autoRenewStatus = lastTransaction.autoRenewStatus === 1;
        currentPlan = determinePlanType(lastTransaction.productId);
        break;
      } else if (status === 4) { // Billing Grace Period
        isActive = true;
        currentPlan = determinePlanType(lastTransaction.productId);
        break;
      }
    }

    return {
      success: true,
      subscription: {
        isActive: isActive,
        currentPlan: currentPlan,
        expirationDate: expirationDate,
        autoRenewStatus: autoRenewStatus,
        subscriptionStatuses: subscriptionStatuses,
      },
      version: "v2",
    };
  } catch (error) {
    console.error("Error checking subscription status:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      "Failed to check subscription status",
    );
  }
});

/**
 * 🔥 App Store 영수증 검증 함수 (Firebase v2 with Secrets)
 */
exports.sub_validateAppStoreReceipt = onCall({
  secrets: [appstoreBundleId],
}, async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "User must be authenticated",
      );
    }

    const {receiptData, isProduction = true} = request.data;

    if (!receiptData) {
      throw new HttpsError(
        "invalid-argument",
        "receiptData is required",
      );
    }

    const bundleId = appstoreBundleId.value();
    const validationUrl = isProduction ?
      APP_STORE_VALIDATION_URL :
      APP_STORE_SANDBOX_URL;

    // App Store 영수증 검증 요청
    const requestBody = {
      "receipt-data": receiptData,
      "password": "", // Auto-renewable subscription의 경우 shared secret 필요
      "exclude-old-transactions": true,
    };

    let response = await axios.post(validationUrl, requestBody, {
      timeout: 10000,
    });

    // 샌드박스에서 실패한 경우 프로덕션으로 재시도
    if (response.data.status === 21007 && isProduction) {
      response = await axios.post(APP_STORE_SANDBOX_URL, requestBody, {
        timeout: 10000,
      });
    }

    const receiptInfo = response.data;

    // 영수증 검증 결과 확인
    if (receiptInfo.status !== 0) {
      const status = receiptInfo.status;
      const errorMsg = "Receipt validation failed with status: " + status;
      throw new HttpsError(
        "invalid-argument",
        errorMsg,
      );
    }

    // Bundle ID 확인
    if (receiptInfo.receipt?.bundle_id !== bundleId) {
      throw new HttpsError(
        "invalid-argument",
        "Bundle ID mismatch",
      );
    }

    // 구독 정보 추출
    const latestReceiptInfo = receiptInfo.latest_receipt_info || [];
    const pendingRenewalInfo = receiptInfo.pending_renewal_info || [];

    // 활성 구독 확인
    const now = Date.now();
    const activeSubscriptions = latestReceiptInfo.filter((transaction) => {
      const expiresDate = parseInt(transaction.expires_date_ms);
      return expiresDate > now;
    });

    return {
      success: true,
      isValid: true,
      hasActiveSubscription: activeSubscriptions.length > 0,
      subscriptions: activeSubscriptions,
      pendingRenewalInfo: pendingRenewalInfo,
      originalTransactionId:
          latestReceiptInfo[0]?.original_transaction_id,
      version: "v2",
    };
  } catch (error) {
    console.error("Error validating receipt:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      "Failed to validate receipt",
    );
  }
});

/**
 * 🔥 구매 완료 알림 처리 함수 (Firebase v2)
 */
exports.sub_notifyPurchaseComplete = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "User must be authenticated",
      );
    }

    const {
      transactionId,
      originalTransactionId,
      productId,
      purchaseDate,
      expirationDate,
    } = request.data;

    if (!transactionId || !originalTransactionId || !productId) {
      throw new HttpsError(
        "invalid-argument",
        "Required purchase data is missing",
      );
    }

    const userId = request.auth.uid;
    const db = admin.firestore();

    // 구매 정보를 Firestore에 저장
    const purchaseData = {
      userId: userId,
      transactionId: transactionId,
      originalTransactionId: originalTransactionId,
      productId: productId,
      purchaseDate: purchaseDate ?
        admin.firestore.Timestamp.fromDate(new Date(purchaseDate)) :
        admin.firestore.FieldValue.serverTimestamp(),
      expirationDate: expirationDate ?
        admin.firestore.Timestamp.fromDate(new Date(expirationDate)) :
        null,
      platform: "ios",
      status: "active",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      version: "v2",
    };

    // 트랜잭션으로 데이터 저장
    await db.runTransaction(async (transaction) => {
      // 구매 기록 저장
      const purchaseRef = db.collection("purchases").doc(transactionId);
      transaction.set(purchaseRef, purchaseData);

      // 사용자 구독 상태 업데이트
      const userRef = db.collection("users").doc(userId);
      const userDoc = await transaction.get(userRef);

      const subscriptionData = {
        hasActiveSubscription: true,
        currentProductId: productId,
        originalTransactionId: originalTransactionId,
        expirationDate: expirationDate ?
          admin.firestore.Timestamp.fromDate(new Date(expirationDate)) :
          null,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        version: "v2",
      };

      if (userDoc.exists) {
        transaction.update(userRef, {
          subscription: subscriptionData,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        transaction.set(userRef, {
          subscription: subscriptionData,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });

    const logMessage = "Purchase completed for user " + userId +
      ", transaction " + transactionId;
    console.log(logMessage);

    return {
      success: true,
      message: "Purchase notification processed successfully",
      transactionId: transactionId,
      version: "v2",
    };
  } catch (error) {
    console.error("Error processing purchase notification:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      "Failed to process purchase notification",
    );
  }
});
