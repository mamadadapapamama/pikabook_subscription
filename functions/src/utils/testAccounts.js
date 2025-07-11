// 📁 functions/utils/testAccounts.js - 내부 테스트 계정
const {Entitlement, SubscriptionStatus} = require("../shared/constant");
const {
  getDateAfterYears,
  getDateAfterDays,
  getDateBeforeDays,
} = require("./dates");

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
      entitlement: Entitlement.PREMIUM,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      hasUsedTrial: true,
      expirationDate: getDateAfterYears(1),
      autoRenewEnabled: true,
      subscriptionType: "yearly",
      originalTransactionId: "test_admin_transaction_001",
      productId: "com.pikabook.premium.yearly",
      hasEverUsedTrial: true,
      hasEverUsedPremium: true,
      // 🎯 배너 전용 메타데이터
      bannerMetadata: {
        bannerType: "premiumStarted",
        bannerDismissedAt: null,
      },
    },

    // 🔵 체험 계정들
    "trial@pikabook.com": {
      entitlement: Entitlement.TRIAL,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      hasUsedTrial: true,
      expirationDate: getDateAfterDays(7),
      autoRenewEnabled: true,
      subscriptionType: "monthly",
      originalTransactionId: "test_trial_transaction_001",
      productId: "com.pikabook.premium.monthly",
      hasEverUsedTrial: true,
      hasEverUsedPremium: false,
      // 🎯 배너 전용 메타데이터
      bannerMetadata: {
        bannerType: "trialStarted",
        bannerDismissedAt: null,
      },
    },

    "trial-cancelled@pikabook.com": {
      entitlement: Entitlement.TRIAL,
      subscriptionStatus: SubscriptionStatus.CANCELLING,
      hasUsedTrial: true,
      expirationDate: getDateAfterDays(3),
      autoRenewEnabled: false,
      subscriptionType: "monthly",
      originalTransactionId: "test_trial_cancelled_transaction_001",
      productId: "com.pikabook.premium.monthly",
      hasEverUsedTrial: true,
      hasEverUsedPremium: false,
      // 🎯 배너 전용 메타데이터
      bannerMetadata: {
        bannerType: "trialCancelled",
        bannerDismissedAt: null,
      },
    },

    "trial-to-pre@pikabook.com": {
      entitlement: Entitlement.PREMIUM,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      hasUsedTrial: true,
      expirationDate: getDateAfterDays(29),
      autoRenewEnabled: true,
      subscriptionType: "monthly",
      originalTransactionId: "test_trial_expired_transaction_001",
      productId: "com.pikabook.premium.monthly",
      hasEverUsedTrial: true,
      hasEverUsedPremium: true,
      // 🎯 배너 전용 메타데이터
      bannerMetadata: {
        bannerType: "trialCompleted",
        bannerDismissedAt: null,
      },
    },

    // 🟡 프리미엄 계정들
    "premium-cancelled@pikabook.com": {
      entitlement: Entitlement.PREMIUM,
      subscriptionStatus: SubscriptionStatus.CANCELLING,
      hasUsedTrial: true,
      expirationDate: getDateAfterDays(15),
      autoRenewEnabled: false,
      subscriptionType: "monthly",
      originalTransactionId: "test_premium_cancelled_transaction_001",
      productId: "com.pikabook.premium.monthly",
      hasEverUsedTrial: true,
      hasEverUsedPremium: true,
      // 🎯 배너 전용 메타데이터
      bannerMetadata: {
        bannerType: "premiumCancelled",
        bannerDismissedAt: null,
      },
    },

    "premium-expired@pikabook.com": {
      entitlement: Entitlement.FREE,
      subscriptionStatus: SubscriptionStatus.EXPIRED,
      hasUsedTrial: true,
      expirationDate: getDateBeforeDays(3),
      autoRenewEnabled: false,
      subscriptionType: null,
      originalTransactionId: "test_premium_expired_transaction_001",
      productId: null,
      hasEverUsedTrial: true,
      hasEverUsedPremium: true,
      // 🎯 배너 전용 메타데이터
      bannerMetadata: {
        bannerType: "premiumExpired",
        bannerDismissedAt: null,
      },
    },

    "premium-grace@pikabook.com": {
      entitlement: Entitlement.PREMIUM,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      hasUsedTrial: true,
      expirationDate: getDateBeforeDays(5),
      gracePeriodEnd: getDateAfterDays(11),
      autoRenewEnabled: false,
      subscriptionType: "monthly",
      originalTransactionId: "test_premium_grace_transaction_001",
      productId: "com.pikabook.premium.monthly",
      hasEverUsedTrial: true,
      hasEverUsedPremium: true,
      // 🎯 배너 전용 메타데이터
      bannerMetadata: {
        bannerType: "premiumGrace",
        bannerDismissedAt: null,
      },
    },

    // 🟠 특수 테스트 계정들
    "refunded@pikabook.com": {
      entitlement: Entitlement.FREE,
      subscriptionStatus: SubscriptionStatus.REFUNDED,
      hasUsedTrial: true,
      expirationDate: getDateBeforeDays(1),
      autoRenewEnabled: false,
      subscriptionType: null,
      originalTransactionId: "test_refunded_transaction_001",
      productId: null,
      hasEverUsedTrial: true,
      hasEverUsedPremium: true,
    },

  };

  const accountInfo = INTERNAL_TEST_ACCOUNTS[email];
  if (!accountInfo) {
    return null;
  }

  console.log(
    `🧪 [내부 계정] ${email}: ` +
    `${accountInfo.entitlement}/${accountInfo.subscriptionStatus}`);

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

module.exports = {
  checkInternalTestAccount,
};
