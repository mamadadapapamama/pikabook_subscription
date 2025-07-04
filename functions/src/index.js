// Firebase Functions v2 with Secrets Manager
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const axios = require("axios");
const jwt = require("jsonwebtoken");

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

// 날짜 유틸 함수들
/**
 * @param {number} years
 * @return {Date}
 */
function getDateAfterYears(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d;
}
/**
 * @param {number} months
 * @return {Date}
 */
function getDateAfterMonths(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d;
}
/**
 * @param {number} days
 * @return {Date}
 */
function getDateAfterDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
/**
 * @param {number} days
 * @return {Date}
 */
function getDateBeforeDays(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

// 🖥️ 향상된 내부 테스트 계정 시스템
/**
 * 내부 테스트 계정 체크
 * @param {string} email
 * @return {object|null}
 */
function checkInternalTestAccount(email) {
  if (!email) return null;

  // 🟢 프리미엄 활성 계정들
  const INTERNAL_TEST_ACCOUNTS = {
    // 🟢 프리미엄 활성 계정들
    "admin@pikabook.com": {
      currentPlan: "premium",
      isActive: true,
      isFreeTrial: false,
      autoRenewStatus: true,
      expirationDate: getDateAfterYears(1),
      description: "관리자 계정 (프리미엄 활성)",
      usage: {
        ttsCount: 50,
        noteCount: 10,
        monthlyLimit: 1000,
        isLimitExceeded: false,
      },
    },

    "developer@pikabook.com": {
      currentPlan: "premium",
      isActive: true,
      isFreeTrial: false,
      autoRenewStatus: true,
      expirationDate: getDateAfterYears(1),
      description: "개발자 계정 (프리미엄 활성)",
      usage: {
        ttsCount: 100,
        noteCount: 25,
        monthlyLimit: 1000,
        isLimitExceeded: false,
      },
    },

    // 🔵 체험 계정들
    "trial@pikabook.com": {
      currentPlan: "trial",
      isActive: true,
      isFreeTrial: true,
      autoRenewStatus: true,
      expirationDate: getDateAfterDays(7),
      description: "체험 계정 (7일 체험 중)",
      usage: {
        ttsCount: 20,
        noteCount: 5,
        monthlyLimit: 1000,
        isLimitExceeded: false,
      },
    },

    "trial-expired@pikabook.com": {
      currentPlan: "free",
      isActive: false,
      isFreeTrial: false,
      autoRenewStatus: false,
      expirationDate: getDateBeforeDays(1),
      description: "체험 만료 계정 (체험 끝남)",
      hasEverUsedTrial: true,
      usage: {
        ttsCount: 15,
        noteCount: 3,
        monthlyLimit: 50,
        isLimitExceeded: false,
      },
    },

    // 🟡 프리미엄 만료 계정들
    "premium-expired@pikabook.com": {
      currentPlan: "free",
      isActive: false,
      isFreeTrial: false,
      autoRenewStatus: false,
      expirationDate: getDateBeforeDays(3),
      description: "프리미엄 만료 계정 (구독 끝남)",
      hasEverUsedPremium: true,
      usage: {
        ttsCount: 40,
        noteCount: 8,
        monthlyLimit: 50,
        isLimitExceeded: false,
      },
    },

    "premium-grace@pikabook.com": {
      currentPlan: "premium",
      isActive: true,
      isFreeTrial: false,
      autoRenewStatus: false,
      expirationDate: getDateBeforeDays(5),
      gracePeriodEnd: getDateAfterDays(11), // 16일 Grace Period
      description: "프리미엄 Grace Period 계정 (결제 실패)",
      hasEverUsedPremium: true,
      usage: {
        ttsCount: 80,
        noteCount: 15,
        monthlyLimit: 1000,
        isLimitExceeded: false,
      },
    },

    // 🔴 사용량 한도 초과 계정들
    "limit-exceeded@pikabook.com": {
      currentPlan: "free",
      isActive: false,
      isFreeTrial: false,
      autoRenewStatus: false,
      expirationDate: null,
      description: "무료 계정 (사용량 한도 초과)",
      usage: {
        ttsCount: 55,
        noteCount: 12,
        monthlyLimit: 50,
        isLimitExceeded: true,
      },
    },

    "premium-limit-exceeded@pikabook.com": {
      currentPlan: "premium",
      isActive: true,
      isFreeTrial: false,
      autoRenewStatus: true,
      expirationDate: getDateAfterMonths(1),
      description: "프리미엄 계정 (사용량 한도 초과)",
      usage: {
        ttsCount: 1050,
        noteCount: 250,
        monthlyLimit: 1000,
        isLimitExceeded: true,
      },
    },

    // 🟠 특수 테스트 계정들
    "reviewer@pikabook.com": {
      currentPlan: "premium",
      isActive: true,
      isFreeTrial: false,
      autoRenewStatus: true,
      expirationDate: getDateAfterYears(1),
      description: "앱스토어 심사용 계정 (프리미엄)",
      usage: {
        ttsCount: 10,
        noteCount: 2,
        monthlyLimit: 1000,
        isLimitExceeded: false,
      },
    },

    "test-cancel@pikabook.com": {
      currentPlan: "premium",
      isActive: true,
      isFreeTrial: false,
      autoRenewStatus: false, // 취소 예정
      expirationDate: getDateAfterDays(15),
      description: "구독 취소 예정 계정 (자동갱신 OFF)",
      hasEverUsedPremium: true,
      usage: {
        ttsCount: 200,
        noteCount: 45,
        monthlyLimit: 1000,
        isLimitExceeded: false,
      },
    },
  };

  // 계정 정보 조회
  const accountInfo = INTERNAL_TEST_ACCOUNTS[email];
  if (!accountInfo) {
    return null;
  }

  console.log(`🧪 [내부 계정] ${accountInfo.description}: ${email}`);

  // 공통 정보 추가
  const result = {
    ...accountInfo,
    dataSource: "internal_test_account",
    testAccountType: email.split("@")[0], // 이메일 prefix를 타입으로 사용
    lastUpdated: new Date().toISOString(),
  };

  // 날짜를 타임스탬프로 변환
  if (result.expirationDate) {
    result.expirationDate = result.expirationDate.getTime().toString();
  }
  if (result.gracePeriodEnd) {
    result.gracePeriodEnd = result.gracePeriodEnd.getTime().toString();
  }

  return result;
}

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
 * @param {string} productId
 * @return {string}
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
      "/inApps/v1/subscriptions/" +
      originalTransactionId;

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

    const userId = request.auth.uid;
    const email = request.auth.token?.email; // 이메일 추가

    console.log(`🔍 구독 상태 확인 시작 (userId: ${userId}, email: ${email})`);

    // 🎯 Step 1: 내부 테스트 계정 확인 (최우선)
    const testAccountResult = checkInternalTestAccount(email);
    if (testAccountResult) {
      console.log(`🧪 내부 테스트 계정으로 구독 상태 반환: ${testAccountResult.currentPlan}`);
      return {
        success: true,
        subscription: testAccountResult,
        version: "v2",
      };
    }

    // 기존 로직 계속...
    let {originalTransactionId, appStoreFirst} = request.data;

    let subscriptionData = null;
    let dataSource = "unknown";

    // 🎯 Step 2: App Store Connect 우선 확인 (appStoreFirst = true일 때)
    if (appStoreFirst) {
      try {
        console.log(`🔍 App Store Connect 우선 확인 시작 (userId: ${userId})`);

        // originalTransactionId가 없으면 Firestore에서 조회
        if (!originalTransactionId) {
          const db = admin.firestore();
          const userDoc = await db.collection("users").doc(userId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            originalTransactionId =
              userData && userData.subscription ?
                userData.subscription.originalTransactionId :
                undefined;
          }
        }

        // App Store Connect API 호출 (프리미엄/체험 정보)
        if (originalTransactionId) {
          const appStoreData = await checkAppStoreConnect(
            originalTransactionId,
          );
          if (
            appStoreData &&
            (
              appStoreData.currentPlan === "premium" ||
              appStoreData.currentPlan === "trial"
            )
          ) {
            subscriptionData = appStoreData;
            dataSource = "appstore";
            console.log(
              `✅ App Store Connect에서 구독 정보 발견: ${subscriptionData.currentPlan}`,
            );
          }
        }
      } catch (error) {
        console.log(`⚠️ App Store Connect 확인 실패: ${error.message}`);
      }
    }

    // 🎯 Step 3: App Store에 데이터가 없으면 Firebase에서 확인
    if (!subscriptionData) {
      try {
        const db = admin.firestore();
        const userDoc = await db.collection("users").doc(userId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          subscriptionData = {
            currentPlan: userData.currentPlan || "free",
            isActive: userData.isActive || false,
            expirationDate: userData.expirationDate,
            autoRenewStatus: userData.autoRenewStatus || false,
            hasEverUsedTrial: userData.hasEverUsedTrial || false,
            hasEverUsedPremium: userData.hasEverUsedPremium || false,
          };
          dataSource = "firebase";
          console.log(`📱 Firebase에서 구독 정보 사용: ${subscriptionData.currentPlan}`);
        }
      } catch (error) {
        console.log(`❌ Firebase 데이터 확인 실패: ${error.message}`);
      }
    }

    // 🎯 Step 4: 둘 다 없으면 기본값
    if (!subscriptionData) {
      subscriptionData = {
        currentPlan: "free",
        isActive: false,
        hasEverUsedTrial: false,
        hasEverUsedPremium: false,
      };
      dataSource = "default";
      console.log(`📝 기본값으로 구독 정보 설정: ${subscriptionData.currentPlan}`);
    }

    return {
      success: true,
      subscription: subscriptionData,
      dataSource: dataSource, // 클라이언트에서 데이터 소스 확인 가능
      version: "v2",
    };
  } catch (error) {
    console.error("구독 상태 확인 오류:", error);
    return {
      success: false,
      error: error.message,
      dataSource: "error",
      version: "v2",
    };
  }
});

/**
 * App Store Connect API를 통해 구독 상태를 조회합니다.
 * @param {string} originalTransactionId
 * @return {Promise<object|null>}
 */
async function checkAppStoreConnect(originalTransactionId) {
  try {
    // JWT 토큰 생성
    const token = generateServerJWT();

    const apiUrl = APP_STORE_SERVER_API_URL +
      "/inApps/v1/subscriptions/" +
      originalTransactionId;

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
      currentPlan: currentPlan,
      isActive: isActive,
      expirationDate: expirationDate,
      autoRenewStatus: autoRenewStatus,
    };
  } catch (error) {
    console.log(`⚠️ App Store Connect 확인 실패: ${error.message}`);
    return null;
  }
}

// App Store Server Notifications 웹훅 import
const notificationWebhook = require("./notification_webhook");

// 웹훅 함수 export
exports.appStoreNotifications = notificationWebhook.appStoreNotifications;
