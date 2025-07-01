/**
 * 구독 플랜 타입
 */
export type PlanType = 'free' | 'premium';

/**
 * 구독 타입 (월간/연간)
 */
export type SubscriptionType = 'monthly' | 'yearly';

/**
 * 구독 상태 인터페이스
 */
export interface SubscriptionStatus {
  planType: PlanType;
  isActive: boolean;
  isTrial: boolean;
  subscriptionType: SubscriptionType | '';
  expiresAt?: Date;
  hasEverUsedPremium?: boolean;
}

/**
 * App Store Receipt 검증 결과
 */
export interface ReceiptValidationResult {
  success: boolean;
  error?: string;
  subscriptionInfo?: {
    productId: string;
    transactionId: string;
    expiresDate: Date;
    isTrialPeriod: boolean;
  };
}

/**
 * 구매 완료 알림 결과
 */
export interface PurchaseNotificationResult {
  success: boolean;
  error?: string;
}

/**
 * Firestore에 저장될 사용자 구독 정보
 */
export interface UserSubscriptionData {
  uid: string;
  planType: PlanType;
  isActive: boolean;
  isTrial: boolean;
  subscriptionType: SubscriptionType | '';
  productId?: string;
  transactionId?: string;
  purchaseDate?: Date;
  expiresAt?: Date;
  hasEverUsedPremium: boolean;
  lastUpdated: Date;
}

/**
 * App Store Connect API 응답 타입
 */
export interface AppStoreReceiptData {
  receipt: {
    receipt_type: string;
    bundle_id: string;
    in_app: AppStoreInAppPurchase[];
  };
  latest_receipt_info?: AppStoreInAppPurchase[];
  status: number;
}

export interface AppStoreInAppPurchase {
  product_id: string;
  transaction_id: string;
  original_transaction_id: string;
  purchase_date_ms: string;
  expires_date_ms?: string;
  is_trial_period?: string;
  cancellation_date_ms?: string;
} 