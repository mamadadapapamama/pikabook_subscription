import axios from 'axios';
import { 
  ReceiptValidationResult, 
  AppStoreReceiptData, 
  AppStoreInAppPurchase,
  UserSubscriptionData 
} from '../types/subscription';
import { APP_STORE_CONFIG, PRODUCT_IDS } from '../config/constants';
import { updateSubscriptionStatus } from './subscriptionStatus';

/**
 * App Store Receipt을 검증합니다.
 */
export async function validateAppStoreReceipt(
  uid: string,
  receiptData: string
): Promise<ReceiptValidationResult> {
  try {
    console.log(`Receipt 검증 시작: ${uid}`);
    
    // 먼저 Production 환경에서 검증 시도
    let validationResult = await verifyReceiptWithAppStore(receiptData, false);
    
    // Production에서 실패하고 테스트 Receipt인 경우, Sandbox에서 재시도
    if (validationResult.status === APP_STORE_CONFIG.RECEIPT_STATUS.TEST_RECEIPT_IN_PRODUCTION) {
      console.log('Production Receipt이 아님, Sandbox에서 재검증');
      validationResult = await verifyReceiptWithAppStore(receiptData, true);
    }
    
    // Receipt 검증 실패
    if (validationResult.status !== APP_STORE_CONFIG.RECEIPT_STATUS.SUCCESS) {
      return {
        success: false,
        error: `Receipt 검증 실패: 상태 코드 ${validationResult.status}`,
      };
    }
    
    // 최신 구독 정보 추출
    const latestSubscription = extractLatestSubscription(validationResult);
    
    if (!latestSubscription) {
      return {
        success: false,
        error: '유효한 구독 정보를 찾을 수 없습니다.',
      };
    }
    
    // Firestore에 구독 정보 업데이트
    await updateUserSubscriptionFromReceipt(uid, latestSubscription);
    
    console.log(`Receipt 검증 성공: ${uid}`, {
      productId: latestSubscription.product_id,
      expiresDate: latestSubscription.expires_date_ms,
    });
    
    return {
      success: true,
      subscriptionInfo: {
        productId: latestSubscription.product_id,
        transactionId: latestSubscription.transaction_id,
        expiresDate: new Date(parseInt(latestSubscription.expires_date_ms || '0')),
        isTrialPeriod: latestSubscription.is_trial_period === 'true',
      },
    };
    
  } catch (error) {
    console.error('Receipt 검증 중 오류:', error);
    return {
      success: false,
      error: 'Receipt 검증 중 오류가 발생했습니다.',
    };
  }
}

/**
 * App Store API를 통해 Receipt을 검증합니다.
 */
async function verifyReceiptWithAppStore(
  receiptData: string,
  isSandbox: boolean = false
): Promise<AppStoreReceiptData> {
  const url = isSandbox 
    ? APP_STORE_CONFIG.VERIFY_RECEIPT_URL_SANDBOX
    : APP_STORE_CONFIG.VERIFY_RECEIPT_URL_PRODUCTION;
  
  const requestBody = {
    'receipt-data': receiptData,
    'password': process.env.APP_STORE_SHARED_SECRET, // App Store Connect에서 생성한 공유 비밀번호
    'exclude-old-transactions': true,
  };
  
  const response = await axios.post(url, requestBody, {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 10000, // 10초 타임아웃
  });
  
  return response.data as AppStoreReceiptData;
}

/**
 * Receipt 데이터에서 최신 구독 정보를 추출합니다.
 */
function extractLatestSubscription(receiptData: AppStoreReceiptData): AppStoreInAppPurchase | null {
  // latest_receipt_info가 있으면 우선 사용
  const subscriptions = receiptData.latest_receipt_info || receiptData.receipt.in_app;
  
  if (!subscriptions || subscriptions.length === 0) {
    return null;
  }
  
  // 유효한 구독 상품만 필터링
  const validSubscriptions = subscriptions.filter(sub => 
    Object.values(PRODUCT_IDS).includes(sub.product_id)
  );
  
  if (validSubscriptions.length === 0) {
    return null;
  }
  
  // 가장 최근 구매 또는 만료일이 가장 늦은 구독 선택
  const latestSubscription = validSubscriptions.reduce((latest, current) => {
    const latestExpires = parseInt(latest.expires_date_ms || '0');
    const currentExpires = parseInt(current.expires_date_ms || '0');
    
    return currentExpires > latestExpires ? current : latest;
  });
  
  return latestSubscription;
}

/**
 * Receipt 정보를 바탕으로 사용자 구독 상태를 업데이트합니다.
 */
async function updateUserSubscriptionFromReceipt(
  uid: string,
  subscription: AppStoreInAppPurchase
): Promise<void> {
  const now = new Date();
  const expiresAt = subscription.expires_date_ms 
    ? new Date(parseInt(subscription.expires_date_ms))
    : undefined;
  
  // 구독이 현재 활성 상태인지 확인
  const isActive = expiresAt ? expiresAt > now : false;
  const isTrial = subscription.is_trial_period === 'true';
  const isCancelled = !!subscription.cancellation_date_ms;
  
  // 상품 ID를 바탕으로 구독 타입 결정
  let subscriptionType: 'monthly' | 'yearly' | '' = '';
  if (subscription.product_id.includes('yearly')) {
    subscriptionType = 'yearly';
  } else if (subscription.product_id.includes('monthly')) {
    subscriptionType = 'monthly';
  }
  
  const subscriptionData: Partial<UserSubscriptionData> = {
    uid,
    planType: isActive ? 'premium' : 'free',
    isActive: isActive && !isCancelled,
    isTrial,
    subscriptionType,
    productId: subscription.product_id,
    transactionId: subscription.transaction_id,
    purchaseDate: new Date(parseInt(subscription.purchase_date_ms)),
    expiresAt,
    hasEverUsedPremium: true, // Receipt가 있다는 것은 프리미엄을 구매한 적이 있다는 의미
    lastUpdated: now,
  };
  
  await updateSubscriptionStatus(uid, subscriptionData);
} 