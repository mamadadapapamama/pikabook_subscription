// 📁 functions/subscription/planStatusLogic.js - 구독 상태 판단 로직
const {Entitlement, SubscriptionStatus} = require("../shared/constant");

/**
 * 구독 정보를 기반으로 정확한 구독 상태를 판단합니다.
 * @param {object} subscriptionInfo - 구독 정보 객체
 * @return {object} 새로운 구조의 구독 상태
 */
function determinePlanStatus({
  currentPlan,
  isActive,
  isFreeTrial,
  autoRenewStatus,
  expirationDate,
  revocationDate,
  isInGracePeriod,
  hasEverUsedTrial = false,
  hasEverUsedPremium = false,
}) {
  const now = Date.now();
  const isExpired = expirationDate && new Date(expirationDate).getTime() < now;

  // 🎯 entitlement 결정 (기능 접근)
  let entitlement = Entitlement.FREE;
  if (isFreeTrial && (isActive || !isExpired)) {
    entitlement = Entitlement.TRIAL;
  } else if (currentPlan?.startsWith("premium") && (isActive || !isExpired)) {
    entitlement = Entitlement.PREMIUM;
  }

  // 🎯 subscriptionStatus 결정 (구독 생명주기)
  let subscriptionStatus = SubscriptionStatus.ACTIVE;

  if (revocationDate) {
    subscriptionStatus = SubscriptionStatus.REFUNDED;
  } else if (isExpired) {
    subscriptionStatus = SubscriptionStatus.EXPIRED;
  } else if (!autoRenewStatus &&
    (isActive || entitlement !== Entitlement.FREE)) {
    // 취소했지만 아직 기간이 남은 경우
    subscriptionStatus = SubscriptionStatus.CANCELLING;
  } else if (!isActive && !isExpired) {
    subscriptionStatus = SubscriptionStatus.CANCELLED;
  }

  // 🎯 hasUsedTrial 결정
  const hasUsedTrial = hasEverUsedTrial || isFreeTrial;

  return {
    entitlement,
    subscriptionStatus,
    hasUsedTrial,
    // 추가 메타데이터
    autoRenewEnabled: autoRenewStatus || false,
    expirationDate: expirationDate || null,
  };
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
