import * as admin from 'firebase-admin';
import { SubscriptionStatus, UserSubscriptionData } from '../types/subscription';
import { FIRESTORE_COLLECTIONS, CACHE_CONFIG } from '../config/constants';

/**
 * 사용자의 구독 상태를 조회합니다.
 */
export async function getSubscriptionStatus(
  uid: string, 
  forceRefresh: boolean = false
): Promise<SubscriptionStatus> {
  try {
    const db = admin.firestore();
    
    // Firestore에서 사용자 구독 정보 조회
    const subscriptionRef = db
      .collection(FIRESTORE_COLLECTIONS.SUBSCRIPTIONS)
      .doc(uid);
    
    const subscriptionDoc = await subscriptionRef.get();
    
    if (!subscriptionDoc.exists) {
      // 구독 정보가 없으면 무료 플랜으로 초기화
      const freeSubscription: UserSubscriptionData = {
        uid,
        planType: 'free',
        isActive: false,
        isTrial: false,
        subscriptionType: '',
        hasEverUsedPremium: false,
        lastUpdated: new Date(),
      };
      
      await subscriptionRef.set(freeSubscription);
      
      return {
        planType: 'free',
        isActive: false,
        isTrial: false,
        subscriptionType: '',
        hasEverUsedPremium: false,
      };
    }
    
    const subscriptionData = subscriptionDoc.data() as UserSubscriptionData;
    
    // 구독 만료 확인
    const now = new Date();
    let isExpired = false;
    
    if (subscriptionData.expiresAt) {
      isExpired = now > subscriptionData.expiresAt;
      
      // 만료된 구독이면 상태 업데이트
      if (isExpired && subscriptionData.isActive) {
        const updatedData: Partial<UserSubscriptionData> = {
          isActive: false,
          lastUpdated: now,
          hasEverUsedPremium: true, // 프리미엄을 사용한 적이 있음을 기록
        };
        
        await subscriptionRef.update(updatedData);
        
        // 업데이트된 데이터 반영
        subscriptionData.isActive = false;
        subscriptionData.hasEverUsedPremium = true;
      }
    }
    
    return {
      planType: subscriptionData.planType,
      isActive: subscriptionData.isActive && !isExpired,
      isTrial: subscriptionData.isTrial,
      subscriptionType: subscriptionData.subscriptionType,
      expiresAt: subscriptionData.expiresAt,
      hasEverUsedPremium: subscriptionData.hasEverUsedPremium,
    };
    
  } catch (error) {
    console.error('구독 상태 조회 실패:', error);
    
    // 오류 시 무료 플랜 반환
    return {
      planType: 'free',
      isActive: false,
      isTrial: false,
      subscriptionType: '',
      hasEverUsedPremium: false,
    };
  }
}

/**
 * 사용자의 구독 상태를 업데이트합니다.
 */
export async function updateSubscriptionStatus(
  uid: string,
  subscriptionData: Partial<UserSubscriptionData>
): Promise<void> {
  try {
    const db = admin.firestore();
    const subscriptionRef = db
      .collection(FIRESTORE_COLLECTIONS.SUBSCRIPTIONS)
      .doc(uid);
    
    const updateData = {
      ...subscriptionData,
      lastUpdated: new Date(),
    };
    
    await subscriptionRef.set(updateData, { merge: true });
    
    console.log(`구독 상태 업데이트 완료: ${uid}`, updateData);
    
  } catch (error) {
    console.error('구독 상태 업데이트 실패:', error);
    throw error;
  }
}

/**
 * 사용자가 프리미엄을 사용한 적이 있는지 확인합니다.
 */
export async function hasEverUsedPremium(uid: string): Promise<boolean> {
  try {
    const db = admin.firestore();
    const subscriptionRef = db
      .collection(FIRESTORE_COLLECTIONS.SUBSCRIPTIONS)
      .doc(uid);
    
    const subscriptionDoc = await subscriptionRef.get();
    
    if (!subscriptionDoc.exists) {
      return false;
    }
    
    const subscriptionData = subscriptionDoc.data() as UserSubscriptionData;
    return subscriptionData.hasEverUsedPremium || false;
    
  } catch (error) {
    console.error('프리미엄 사용 이력 확인 실패:', error);
    return false;
  }
} 