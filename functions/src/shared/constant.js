// 📁 functions/shared/constants.js - 공통 상수

// 기능 접근 제어
const Entitlement = {
  FREE: "free",
  TRIAL: "trial",
  PREMIUM: "premium",
};

// 구독 생명주기 상태
const SubscriptionStatus = {
  ACTIVE: "active",
  CANCELLING: "cancelling",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  REFUNDED: "refunded",
  NEVER_SUBSCRIBED: "never_subscribed", // 신규 가입자
};

const APP_STORE_SERVER_API_URL = "https://api.storekit.itunes.apple.com";

module.exports = {
  Entitlement,
  SubscriptionStatus,
  APP_STORE_SERVER_API_URL,
};
