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
  region: "asia-southeast1",
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

// 🎯 구독 상태 Enum 정의
const PlanStatus = {
  FREE: "free",
  TRIAL_ACTIVE: "trial_active",           // 체험 중
  TRIAL_CANCELLED: "trial_cancelled",     // 체험 취소됨 (만료 전까지 사용 가능)
  TRIAL_COMPLETED: "trial_completed",     // 체험 완료 → 유료 전환됨
  PREMIUM_ACTIVE: "premium_active",       // 프리미엄 활성
  PREMIUM_CANCELLED: "premium_cancelled", // 프리미엄 취소 예정 (만료 전까지 사용 가능)
  PREMIUM_EXPIRED: "premium_expired",     // 프리미엄 만료
  PREMIUM_GRACE: "premium_grace",         // 결제 실패 유예기간
  REFUNDED: "refunded",                   // 환불됨
};

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

  const INTERNAL_TEST_ACCOUNTS = {
    // 🟢 프리미엄 활성 계정들
    "admin@pikabook.com": {
      planStatus: PlanStatus.PREMIUM_ACTIVE,
      expirationDate: getDateAfterYears(1),
      description: "관리자 계정 (프리미엄 활성)",
      autoRenewStatus: true,
    },

    "developer@pikabook.com": {
      planStatus: PlanStatus.PREMIUM_ACTIVE,
      expirationDate: getDateAfterYears(1),
      description: "개발자 계정 (프리미엄 활성)",
      autoRenewStatus: true,
    },

    // 🔵 체험 계정들
    "trial@pikabook.com": {
      planStatus: PlanStatus.TRIAL_ACTIVE,
      expirationDate: getDateAfterDays(7),
      description: "체험 계정 (7일 체험 중)",
      autoRenewStatus: true,
    },

    "trial-cancelled@pikabook.com": {
      planStatus: PlanStatus.TRIAL_CANCELLED,
      expirationDate: getDateAfterDays(3),
      description: "체험 취소 계정 (3일 남음)",
      autoRenewStatus: false,
    },

    "trial-expired@pikabook.com": {
      planStatus: PlanStatus.FREE,
      expirationDate: getDateBeforeDays(1),
      description: "체험 만료 계정",
      autoRenewStatus: false,
      hasEverUsedTrial: true,
    },

    // 🟡 프리미엄 계정들
    "premium-cancelled@pikabook.com": {
      planStatus: PlanStatus.PREMIUM_CANCELLED,
      expirationDate: getDateAfterDays(15),
      description: "프리미엄 취소 예정 계정 (15일 남음)",
      autoRenewStatus: false,
      hasEverUsedPremium: true,
    },

    "premium-expired@pikabook.com": {
      planStatus: PlanStatus.PREMIUM_EXPIRED,
      expirationDate: getDateBeforeDays(3),
      description: "프리미엄 만료 계정",
      autoRenewStatus: false,
      hasEverUsedPremium: true,
    },

    "premium-grace@pikabook.com": {
      planStatus: PlanStatus.PREMIUM_GRACE,
      expirationDate: getDateBeforeDays(5),
      gracePeriodEnd: getDateAfterDays(11),
      description: "프리미엄 Grace Period 계정 (결제 실패)",
      autoRenewStatus: false,
      hasEverUsedPremium: true,
    },

    // 🟠 특수 테스트 계정들
    "reviewer@pikabook.com": {
      planStatus: PlanStatus.PREMIUM_ACTIVE,
      expirationDate: getDateAfterYears(1),
      description: "앱스토어 심사용 계정",
      autoRenewStatus: true,
    },

    "refunded@pikabook.com": {
      planStatus: PlanStatus.REFUNDED,
      expirationDate: getDateBeforeDays(1),
      description: "환불된 계정",
      autoRenewStatus: false,
      hasEverUsedPremium: true,
    },
  };

  const accountInfo = INTERNAL_TEST_ACCOUNTS[email];
  if (!accountInfo) {
    return null;
  }

  console.log(`🧪 [내부 계정] ${accountInfo.description}: ${email}`);

  // 공통 정보 추가
  const result = {
    ...accountInfo,
    dataSource: "internal_test_account",
    testAccountType: email.split("@")[0],
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
 * 구독 정보를 기반으로 정확한 구독 상태를 판단합니다.
 * @param {object} subscriptionInfo - 구독 정보 객체
 * @return {string} PlanStatus enum 값
 */
function determinePlanStatus({ currentPlan, isActive, isFreeTrial, autoRenewStatus, expirationDate, revocationDate, isInGracePeriod }) {
  const now = Date.now();
  
  // 1. 환불 여부 확인 (최우선)
  if (revocationDate) return PlanStatus.REFUNDED;
  
  // 2. 무료 플랜 확인
  if (!currentPlan || currentPlan === "free") return PlanStatus.FREE;
  
  // 3. 체험 상태 판단 (시간 기반)
  if (isFreeTrial) {
    const trialEnd = new Date(expirationDate).getTime();
    if (now < trialEnd) {
      return autoRenewStatus ? PlanStatus.TRIAL_ACTIVE : PlanStatus.TRIAL_CANCELLED;
    } else {
      return PlanStatus.TRIAL_COMPLETED;
    }
  }
  
  // 4. 프리미엄 상태 판단
  if (currentPlan.startsWith("premium")) {
    if (isActive) {
      return autoRenewStatus ? PlanStatus.PREMIUM_ACTIVE : PlanStatus.PREMIUM_CANCELLED;
    } else {
      // Grace Period 확인 (만료되었지만 유예기간 중)
      if (isInGracePeriod) {
        return PlanStatus.PREMIUM_GRACE;
      }
      return PlanStatus.PREMIUM_EXPIRED;
    }
  }
  
  return PlanStatus.FREE;
}

/**
 * App Store Connect 거래 정보에서 구독 정보를 추출합니다.
 * @param {object} lastTransaction - App Store Connect의 마지막 거래 정보
 * @param {object} renewalInfo - 갱신 정보 (선택사항)
 * @return {object} 구독 정보 객체
 */
function extractSubscriptionInfo(lastTransaction, renewalInfo = null) {
  if (!lastTransaction) {
    return {
      currentPlan: "free",
      isActive: false,
      isFreeTrial: false,
      autoRenewStatus: false,
      expirationDate: null,
      revocationDate: null,
      isInGracePeriod: false
    };
  }

  const status = lastTransaction.status;
  const productId = lastTransaction.productId;
  
  // 기본 정보 추출
  const isActive = status === 1; // Active
  const isFreeTrial = lastTransaction.isInIntroOfferPeriod === true || lastTransaction.offerIdentifier;
  const autoRenewStatus = lastTransaction.autoRenewStatus === 1;
  const expirationDate = lastTransaction.expiresDate;
  const revocationDate = lastTransaction.revocationDate || null;
  
  // 🎯 Grace Period 확인 (App Store 상태 코드 기반)
  const isInGracePeriod = status === 3 || status === 4; // Billing Retry or Billing Grace Period
  
  // 플랜 타입 결정
  let currentPlan = "free";
  if (productId.includes("monthly")) {
    currentPlan = "premium_monthly";
  } else if (productId.includes("yearly")) {
    currentPlan = "premium_yearly";
  }
  
  return {
    currentPlan,
    isActive,
    isFreeTrial,
    autoRenewStatus,
    expirationDate,
    revocationDate,
    isInGracePeriod
  };
}

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
    const email = request.auth.token?.email;

    console.log(`🔍 구독 상태 확인 시작 (userId: ${userId}, email: ${email})`);

    // 🎯 Step 1: 내부 테스트 계정 확인 (최우선)
    const testAccountResult = checkInternalTestAccount(email);
    if (testAccountResult) {
      console.log(`🧪 내부 테스트 계정으로 구독 상태 반환: ${testAccountResult.planStatus}`);
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
              userData?.subscription?.originalTransactionId;
          }
        }

        // App Store Connect API 호출
        if (originalTransactionId) {
          const appStoreData = await checkAppStoreConnect(originalTransactionId);
          if (appStoreData && appStoreData.planStatus !== PlanStatus.FREE) {
            subscriptionData = appStoreData;
            dataSource = "appstore";
            console.log(`✅ App Store Connect에서 구독 정보 발견: ${subscriptionData.planStatus}`);
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
            planStatus: userData.planStatus || PlanStatus.FREE,
            expirationDate: userData.expirationDate,
            autoRenewStatus: userData.autoRenewStatus || false,
            hasEverUsedTrial: userData.hasEverUsedTrial || false,
            hasEverUsedPremium: userData.hasEverUsedPremium || false,
          };
          dataSource = "firebase";
          console.log(`📱 Firebase에서 구독 정보 사용: ${subscriptionData.planStatus}`);
        }
      } catch (error) {
        console.log(`❌ Firebase 데이터 확인 실패: ${error.message}`);
      }
    }

    // 🎯 Step 4: 둘 다 없으면 기본값
    if (!subscriptionData) {
      subscriptionData = {
        planStatus: PlanStatus.FREE,
        autoRenewStatus: false,
        hasEverUsedTrial: false,
        hasEverUsedPremium: false,
      };
      dataSource = "default";
      console.log(`📝 기본값으로 구독 정보 설정: ${subscriptionData.planStatus}`);
    }

    return {
      success: true,
      subscription: subscriptionData,
      dataSource: dataSource,
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
    const subscriptionStatuses = subscriptionData.data || [];

    // 가장 최근 활성 구독 찾기
    let latestTransaction = null;
    let renewalInfo = null;

    for (const subscription of subscriptionStatuses) {
      const lastTransaction = subscription.lastTransactions?.[0];
      if (lastTransaction) {
        latestTransaction = lastTransaction;
        renewalInfo = subscription.renewalInfo;
        break;
      }
    }

    if (!latestTransaction) {
      return null;
    }

    // 🎯 App Store 데이터에서 구독 정보 추출
    const subscriptionInfo = extractSubscriptionInfo(latestTransaction, renewalInfo);
    
    // 🎯 비즈니스 로직으로 상태 판단
    const planStatus = determinePlanStatus(subscriptionInfo);
    
    // 추가 정보
    const expirationDate = latestTransaction.expiresDate;
    const autoRenewStatus = latestTransaction.autoRenewStatus === 1;
    
    // 이력 정보 판단
    const isFreeTrial = planStatus.includes("trial");
    const isPremium = planStatus.includes("premium");
    const hasEverUsedTrial = isFreeTrial || planStatus === PlanStatus.TRIAL_COMPLETED;
    const hasEverUsedPremium = isPremium && !isFreeTrial;

    return {
      planStatus: planStatus,
      expirationDate: expirationDate,
      autoRenewStatus: autoRenewStatus,
      hasEverUsedTrial: hasEverUsedTrial,
      hasEverUsedPremium: hasEverUsedPremium,
      dataSource: "appstore"
    };
  } catch (error) {
    console.log(`⚠️ App Store Connect API 호출 실패: ${error.message}`);
    return null;
  }
}

// App Store Server Notifications 웹훅 import
const notificationWebhook = require("../webhook/appStoreNotifications");

// 웹훅 함수 export
exports.appStoreNotifications = notificationWebhook.appStoreNotifications;