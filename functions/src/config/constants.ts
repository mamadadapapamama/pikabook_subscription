/**
 * App Store Connect API 관련 상수
 */
export const APP_STORE_CONFIG = {
  // App Store Connect API URLs
  VERIFY_RECEIPT_URL_SANDBOX: 'https://sandbox.itunes.apple.com/verifyReceipt',
  VERIFY_RECEIPT_URL_PRODUCTION: 'https://buy.itunes.apple.com/verifyReceipt',
  
  // 번들 ID (실제 앱의 번들 ID로 변경 필요)
  BUNDLE_ID: 'com.example.pikabook',
  
  // Receipt 상태 코드
  RECEIPT_STATUS: {
    SUCCESS: 0,
    TEST_RECEIPT_IN_PRODUCTION: 21007,
    INVALID_RECEIPT: 21002,
    RECEIPT_SERVER_UNAVAILABLE: 21005,
  }
};

/**
 * 상품 ID 상수 (클라이언트와 동일해야 함)
 */
export const PRODUCT_IDS = {
  PREMIUM_MONTHLY: 'premium_monthly',
  PREMIUM_YEARLY: 'premium_yearly',
  PREMIUM_MONTHLY_WITH_TRIAL: 'premium_monthly_trial',
  PREMIUM_YEARLY_WITH_TRIAL: 'premium_yearly_trial',
};

/**
 * Firestore 컬렉션 이름
 */
export const FIRESTORE_COLLECTIONS = {
  USERS: 'users',
  SUBSCRIPTIONS: 'subscriptions',
  RECEIPTS: 'receipts',
};

/**
 * 캐시 관련 상수
 */
export const CACHE_CONFIG = {
  SUBSCRIPTION_STATUS_TTL: 5 * 60 * 1000, // 5분
  RECEIPT_VALIDATION_TTL: 10 * 60 * 1000, // 10분
};

/**
 * 환경 변수 키
 */
export const ENV_KEYS = {
  APP_STORE_CONNECT_API_KEY: 'APP_STORE_CONNECT_API_KEY',
  APP_STORE_CONNECT_KEY_ID: 'APP_STORE_CONNECT_KEY_ID',
  APP_STORE_CONNECT_ISSUER_ID: 'APP_STORE_CONNECT_ISSUER_ID',
};