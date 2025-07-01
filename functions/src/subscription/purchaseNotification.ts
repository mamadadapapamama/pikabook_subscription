import { PurchaseNotificationResult } from '../types/subscription';
import { updateSubscriptionStatus } from './subscriptionStatus';
import { PRODUCT_IDS } from '../config/constants';

/**
 * 구매 완료 알림을 처리합니다.
 */
export async function notifyPurchaseComplete(
  uid: string,
  productId: string,
  transactionId: string
): Promise<PurchaseNotificationResult> {
  try {
    console.log(`구매 완료 알림 처리 시작: ${uid}`, { productId, transactionId });
    
    // 유효한 상품 ID인지 확인
    if (!Object.values(PRODUCT_IDS).includes(productId)) {
      return {
        success: false,
        error: `유효하지 않은 상품 ID: ${productId}`,
      };
    }
    
    // 상품 ID를 바탕으로 구독 정보 결정
    const subscriptionInfo = determineSubscriptionInfo(productId);
    
    // Firestore에 구독 상태 업데이트
    await updateSubscriptionStatus(uid, {
      uid,
      planType: 'premium',
      isActive: true,
      isTrial: subscriptionInfo.isTrial,
      subscriptionType: subscriptionInfo.subscriptionType,
      productId,
      transactionId,
      purchaseDate: new Date(),
      hasEverUsedPremium: true,
      // 만료일은 Receipt 검증을 통해 정확한 값으로 업데이트될 예정
    });
    
    console.log(`구매 완료 알림 처리 성공: ${uid}`, subscriptionInfo);
    
    return {
      success: true,
    };
    
  } catch (error) {
    console.error('구매 완료 알림 처리 실패:', error);
    return {
      success: false,
      error: '구매 완료 알림 처리 중 오류가 발생했습니다.',
    };
  }
}

/**
 * 상품 ID를 바탕으로 구독 정보를 결정합니다.
 */
function determineSubscriptionInfo(productId: string): {
  subscriptionType: 'monthly' | 'yearly';
  isTrial: boolean;
} {
  switch (productId) {
    case PRODUCT_IDS.PREMIUM_MONTHLY:
      return { subscriptionType: 'monthly', isTrial: false };
    
    case PRODUCT_IDS.PREMIUM_YEARLY:
      return { subscriptionType: 'yearly', isTrial: false };
    
    case PRODUCT_IDS.PREMIUM_MONTHLY_WITH_TRIAL:
      return { subscriptionType: 'monthly', isTrial: true };
    
    case PRODUCT_IDS.PREMIUM_YEARLY_WITH_TRIAL:
      return { subscriptionType: 'yearly', isTrial: true };
    
    default:
      // 기본값 (에러 상황이지만 안전장치)
      return { subscriptionType: 'monthly', isTrial: false };
  }
} 