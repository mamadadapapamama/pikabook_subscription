// 📁 functions/shared/constants.js - 공통 상수

// 기능 접근 제어
const Entitlement = {
  FREE: "free",
  TRIAL: "trial",
  PREMIUM: "premium",
};

/**
 * 🎯 구독 상태 (숫자)
 * 1: 활성 (정상 구독, 유예 기간 포함)
 * 2: 만료됨
 * 3: 환불됨
 * 4: 유예 기간
 * 5: 알 수 없음 (오류 등)
 * 6: 비활성 (구독 안 함)
 * 7: 취소됨 (만료 예정)
 * 8: 무료 체험
 * 9: 프로모션
 * 10: 가족 공유
 * 11: 업그레이드/다운그레이드 진행 중
 * 12: 계정 보류
 */
const SubscriptionStatus = {
  ACTIVE: 1,
  EXPIRED: 2,
  REFUNDED: 3,
  GRACE_PERIOD: 4,
  UNKNOWN: 5,
  INACTIVE: 6,
  CANCELLED: 7,
  TRIAL: 8,
  PROMOTION: 9,
  FAMILY_SHARED: 10,
  IN_UPGRADE: 11,
  ON_HOLD: 12,
  UNVERIFIED: 13, // 🔥 구매 정보 미확인 (JWS 전송 필요)
};

const APP_STORE_SERVER_API_URL = "https://api.storekit.itunes.apple.com";

module.exports = {
  Entitlement,
  SubscriptionStatus,
  APP_STORE_SERVER_API_URL,
};
