// 📁 functions/shared/constants.js - 공통 상수
const PlanStatus = {
  FREE: "free",
  TRIAL_ACTIVE: "trial_active",
  TRIAL_CANCELLED: "trial_cancelled",
  TRIAL_COMPLETED: "trial_completed",
  PREMIUM_ACTIVE: "premium_active",
  PREMIUM_CANCELLED: "premium_cancelled",
  PREMIUM_EXPIRED: "premium_expired",
  PREMIUM_GRACE: "premium_grace",
  REFUNDED: "refunded",
};

const APP_STORE_SERVER_API_URL = "https://api.storekit.itunes.apple.com";

module.exports = {
  PlanStatus,
  APP_STORE_SERVER_API_URL,
};
