// 📁 functions/subscription/planStatusLogic.js - 구독 상태 판단 로직
const {PlanStatus} = require("../shared/constants");

/**
 * 구독 정보를 기반으로 정확한 구독 상태를 판단합니다.
 * @param {object} subscriptionInfo - 구독 정보 객체
 * @return {string} PlanStatus enum 값
 */
function determinePlanStatus({
  currentPlan,
  isActive,
  isFreeTrial,
  autoRenewStatus,
  expirationDate,
  revocationDate,
  isInGracePeriod,
}) {
  const now = Date.now();

  // 1. 환불 여부 확인 (최우선)
  if (revocationDate) return PlanStatus.REFUNDED;

  // 2. 무료 플랜 확인
  if (!currentPlan || currentPlan === "free") return PlanStatus.FREE;

  // 3. 체험 상태 판단 (시간 기반)
  if (isFreeTrial) {
    const trialEnd = new Date(expirationDate).getTime();
    if (now < trialEnd) {
      return autoRenewStatus ?
        PlanStatus.TRIAL_ACTIVE :
        PlanStatus.TRIAL_CANCELLED;
    } else {
      return PlanStatus.TRIAL_COMPLETED;
    }
  }

  // 4. 프리미엄 상태 판단
  if (currentPlan.startsWith("premium")) {
    if (isActive) {
      return autoRenewStatus ?
        PlanStatus.PREMIUM_ACTIVE :
        PlanStatus.PREMIUM_CANCELLED;
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
      isInGracePeriod: false,
    };
  }

  const status = lastTransaction.status;
  const productId = lastTransaction.productId;

  // 기본 정보 추출
  const isActive = status === 1; // Active
  const isFreeTrial = lastTransaction.isInIntroOfferPeriod === true ||
    lastTransaction.offerIdentifier;
  const autoRenewStatus = lastTransaction.autoRenewStatus === 1;
  const expirationDate = lastTransaction.expiresDate;
  const revocationDate = lastTransaction.revocationDate || null;

  // 🎯 Grace Period 확인 (App Store 상태 코드 기반)
  const isInGracePeriod = status === 3 || status === 4;

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
    isInGracePeriod,
  };
}

module.exports = {
  determinePlanStatus,
  extractSubscriptionInfo,
};
