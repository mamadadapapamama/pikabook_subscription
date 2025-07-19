// 📁 functions/src/utils/subscriptionDataManager.js
// 🎯 구독 데이터 통합 관리 (Single Source of Truth)

const admin = require("firebase-admin");

/**
 * 🎯 통합 구독 데이터 업데이트 함수
 *
 * Best Practice:
 * - subscriptionData 필드만 사용 (Single Source of Truth)
 * - undefined 값 자동 제거
 * - 메타데이터 일관성 보장
 * - 데이터 버전 관리
 *
 * @param {admin.firestore.Firestore} db - Firestore 인스턴스
 * @param {string} userId - 사용자 ID
 * @param {object} updates - 업데이트할 구독 데이터
 * @param {string} source - 업데이트 소스 ("syncPurchaseInfo" | "webhook" | "checkSubscriptionStatus")
 * @return {Promise<void>}
 */
async function updateUnifiedSubscriptionData(db, userId, updates, source) {
  try {
    console.log(`🔄 [${source}] 통합 구독 데이터 업데이트 시작:`, userId);

    // 🎯 기본 메타데이터 추가
    const subscriptionData = {
      ...updates,
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdateSource: source,
      dataVersion: "v2",
    };

    // 🎯 undefined 값을 가진 필드 제거 (Firestore 오류 방지)
    const cleanData = {};
    Object.keys(subscriptionData).forEach((key) => {
      if (subscriptionData[key] !== undefined && subscriptionData[key] !== null) {
        cleanData[key] = subscriptionData[key];
      }
    });

    // 🎯 필수 필드 검증
    const requiredFields = ["lastUpdatedAt", "lastUpdateSource", "dataVersion"];
    requiredFields.forEach((field) => {
      if (!cleanData[field]) {
        console.warn(`⚠️ 필수 필드 누락: ${field}`);
      }
    });

    // 🎯 Firestore 업데이트 (subscriptionData만 업데이트)
    const updatePayload = {
      subscriptionData: cleanData,
    };

    await db.collection("users").doc(userId).update(updatePayload);

    console.log(`✅ [${source}] 통합 구독 데이터 업데이트 완료:`, {
      userId: userId,
      fieldsUpdated: Object.keys(cleanData).length,
      source: source,
      entitlement: cleanData.entitlement || "unknown",
      subscriptionStatus: cleanData.subscriptionStatus || "unknown",
    });
  } catch (error) {
    console.error(`❌ [${source}] 통합 구독 데이터 업데이트 실패:`, error);
    throw error;
  }
}

/**
 * 🎯 구독 데이터 조회 함수
 *
 * @param {admin.firestore.Firestore} db - Firestore 인스턴스
 * @param {string} userId - 사용자 ID
 * @return {Promise<object|null>} 구독 데이터 또는 null
 */
async function getUnifiedSubscriptionData(db, userId) {
  try {
    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      return null;
    }

    const userData = userDoc.data();
    return userData.subscriptionData || null;
  } catch (error) {
    console.error("❌ 구독 데이터 조회 실패:", error);
    return null;
  }
}

/**
 * 🎯 레거시 데이터 정리 함수
 *
 * 기존 lastTransactionInfo, lastWebhookNotification 필드를 제거하고
 * subscriptionData로 통합
 *
 * @param {admin.firestore.Firestore} db - Firestore 인스턴스
 * @param {string} userId - 사용자 ID
 * @return {Promise<void>}
 */
async function cleanupLegacyFields(db, userId) {
  try {
    console.log(`🧹 [${userId}] 레거시 필드 정리 시작`);

    const userDoc = await db.collection("users").doc(userId).get();

    if (!userDoc.exists) {
      console.log(`⚠️ 사용자 문서 없음: ${userId}`);
      return;
    }

    const userData = userDoc.data();
    const legacyFields = ["lastTransactionInfo", "lastWebhookNotification"];
    const fieldsToDelete = {};
    let hasLegacyFields = false;

    // 삭제할 레거시 필드 확인
    legacyFields.forEach((field) => {
      if (userData[field] !== undefined) {
        fieldsToDelete[field] = admin.firestore.FieldValue.delete();
        hasLegacyFields = true;
      }
    });

    if (hasLegacyFields) {
      await db.collection("users").doc(userId).update(fieldsToDelete);
      console.log(`✅ [${userId}] 레거시 필드 정리 완료:`, Object.keys(fieldsToDelete));
    } else {
      console.log(`ℹ️ [${userId}] 정리할 레거시 필드 없음`);
    }
  } catch (error) {
    console.error(`❌ [${userId}] 레거시 필드 정리 실패:`, error);
    throw error;
  }
}

/**
 * 🎯 필수 구독 필드 목록
 */
const ESSENTIAL_SUBSCRIPTION_FIELDS = [
  "entitlement",
  "subscriptionStatus",
  "expirationDate",
  "hasUsedTrial",
  "autoRenewEnabled",
  "originalTransactionId",
  "lastTransactionId",
  "productId",
  "subscriptionType",
  "lastUpdatedAt",
  "lastUpdateSource",
  "dataVersion",
];

/**
 * 🎯 조건부 구독 필드 목록 (undefined일 수 있음)
 */
const OPTIONAL_SUBSCRIPTION_FIELDS = [
  "offerType",
  "notificationType",
  "notificationSubtype",
  "purchaseDate",
  "appAccountToken",
  "hasFamilySharedSubscription",
  "environment",
  "subscriptionStartDate",
];

module.exports = {
  updateUnifiedSubscriptionData,
  getUnifiedSubscriptionData,
  cleanupLegacyFields,
  ESSENTIAL_SUBSCRIPTION_FIELDS,
  OPTIONAL_SUBSCRIPTION_FIELDS,
};
