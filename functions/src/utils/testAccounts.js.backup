// 📁 functions/utils/testAccounts.js - 내부 테스트 계정
const {PlanStatus} = require("../shared/constants");
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

module.exports = {
  checkInternalTestAccount,
};
