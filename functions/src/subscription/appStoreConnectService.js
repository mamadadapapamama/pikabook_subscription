// 📁 functions/subscription/appStoreConnectService.js - App Store Connect API 서비스
const axios = require("axios");
const { APP_STORE_SERVER_API_URL } = require('../shared/constant');
const { generateServerJWT } = require('../utils/jwt');
const { determinePlanStatus, extractSubscriptionInfo } = require('./planStatusLogic');

/**
 * App Store Connect API를 통해 구독 상태를 조회합니다.
 * @param {string} originalTransactionId
 * @return {Promise<object|null>}
 */
async function checkAppStoreConnect(originalTransactionId) {
  try {
    const token = generateServerJWT();

    const apiUrl = APP_STORE_SERVER_API_URL +
      "/inApps/v1/subscriptions/" +
      originalTransactionId;

    const response = await axios.get(apiUrl, {
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    const subscriptionData = response.data;
    const subscriptionStatuses = subscriptionData.data || [];

    // 가장 최근 활성 구독 찾기
    let latestTransaction = null;
    let renewalInfo = null;

    for (const subscription of subscriptionStatuses) {
      const lastTransaction = subscription.lastTransactions?.[0];
      if (lastTransaction) {
        latestTransaction = lastTransaction;
        renewalInfo = subscription.renewalInfo;
        break;
      }
    }

    if (!latestTransaction) {
      return null;
    }

    // 🎯 App Store 데이터에서 구독 정보 추출
    const subscriptionInfo = extractSubscriptionInfo(latestTransaction, renewalInfo);
    
    // 🎯 비즈니스 로직으로 상태 판단
    const planStatus = determinePlanStatus(subscriptionInfo);
    
    // 추가 정보
    const expirationDate = latestTransaction.expiresDate;
    const autoRenewStatus = latestTransaction.autoRenewStatus === 1;
    
    // 이력 정보 판단
    const isFreeTrial = planStatus.includes("trial");
    const isPremium = planStatus.includes("premium");
    const hasEverUsedTrial = isFreeTrial || planStatus === "trial_completed";
    const hasEverUsedPremium = isPremium && !isFreeTrial;

    return {
      planStatus: planStatus,
      expirationDate: expirationDate,
      autoRenewStatus: autoRenewStatus,
      hasEverUsedTrial: hasEverUsedTrial,
      hasEverUsedPremium: hasEverUsedPremium,
      dataSource: "appstore"
    };
  } catch (error) {
    console.log(`⚠️ App Store Connect API 호출 실패: ${error.message}`);
    return null;
  }
}

module.exports = {
  checkAppStoreConnect,
};