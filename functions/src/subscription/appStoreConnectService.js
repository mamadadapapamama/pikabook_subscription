// 📁 functions/subscription/appStoreConnectService.js
// Apple 공식 라이브러리 기반 구독 확인
const {appStoreServerClient} = require("../utils/appStoreServerClient");
const {PlanStatus} = require("../shared/constant");

/**
 * 🚀 App Store Connect API로 구독 상태 확인 (Apple 공식 라이브러리 사용)
 *
 * ✅ 개선사항:
 * - Apple 공식 라이브러리 사용으로 안정성 대폭 향상
 * - 자동 JWT 토큰 관리 및 갱신
 * - 에러 처리 및 재시도 로직 내장
 * - 타입 안전성 및 API 호환성 보장
 *
 * @param {string} originalTransactionId - 원본 트랜잭션 ID
 * @return {Promise<object>} 구독 상태 정보
 */
async function checkAppStoreConnect(originalTransactionId) {
  try {
    console.log("🚀 App Store Connect 구독 상태 확인 시작 " +
      "(Apple 공식 라이브러리)");
    console.log("   originalTransactionId:", originalTransactionId);

    if (!originalTransactionId) {
      console.log("❌ originalTransactionId가 없습니다");
      return {
        planStatus: PlanStatus.FREE,
        currentPlan: "free",
        isActive: false,
        error: "No originalTransactionId provided",
      };
    }

    // 🚀 Apple 공식 라이브러리로 구독 상태 조회
    const subscriptionResult = await appStoreServerClient
      .getSubscriptionStatuses(originalTransactionId);

    if (!subscriptionResult.success) {
      console.error("❌ 구독 상태 조회 실패:", subscriptionResult.error);
      return {
        planStatus: PlanStatus.FREE,
        currentPlan: "free",
        isActive: false,
        error: subscriptionResult.error,
      };
    }

    const subscriptionStatuses = subscriptionResult.data;
    console.log("📦 구독 상태 데이터 수신:", subscriptionStatuses);

    // 🎯 최신 구독 상태 분석
    const subscriptionInfo = await analyzeSubscriptionStatuses(
      subscriptionStatuses,
    );

    console.log("✅ App Store Connect 구독 상태 분석 완료:");
    console.log("   - Plan Status:", subscriptionInfo.planStatus);
    console.log("   - Current Plan:", subscriptionInfo.currentPlan);
    console.log("   - Is Active:", subscriptionInfo.isActive);
    console.log("   - Auto Renew:", subscriptionInfo.autoRenewStatus);

    return subscriptionInfo;
  } catch (error) {
    console.error("❌ App Store Connect 조회 중 예외 발생:", error.message);
    return {
      planStatus: PlanStatus.FREE,
      currentPlan: "free",
      isActive: false,
      error: error.message,
    };
  }
}

/**
 * 🎯 구독 상태 데이터 분석 및 변환
 * Apple의 복잡한 구독 상태를 우리 앱에서 사용하는 형태로 변환
 *
 * @param {object} subscriptionStatuses - Apple에서 받은 구독 상태 데이터
 * @return {Promise<object>} 분석된 구독 정보
 */
async function analyzeSubscriptionStatuses(subscriptionStatuses) {
  try {
    console.log("🔍 구독 상태 분석 시작");

    // 기본값 설정
    const result = {
      planStatus: PlanStatus.FREE,
      currentPlan: "free",
      isActive: false,
      autoRenewStatus: false,
      subscriptionType: null,
      expirationDate: null,
      hasEverUsedTrial: false,
      hasEverUsedPremium: false,
    };

    // 구독 그룹 데이터 확인
    if (!subscriptionStatuses || !subscriptionStatuses.length) {
      console.log("⚠️ 구독 상태 데이터가 없습니다");
      return result;
    }

    // 첫 번째 구독 그룹의 최신 구독 상태 가져오기
    const subscriptionGroup = subscriptionStatuses[0];
    const lastTransactions = subscriptionGroup.lastTransactions;

    if (!lastTransactions || !lastTransactions.length) {
      console.log("⚠️ 최신 트랜잭션 데이터가 없습니다");
      return result;
    }

    console.log("📊 분석할 트랜잭션 수:", lastTransactions.length + "개");

    // 🎯 각 트랜잭션의 상태 분석
    for (const transaction of lastTransactions) {
      const signedTransactionInfo = transaction.signedTransactionInfo;
      const status = transaction.status;

      console.log("🔍 트랜잭션 분석: status=" + status);

      // JWT 디코딩하여 트랜잭션 정보 추출
      const decodedTransaction = await decodeTransactionJWT(
        signedTransactionInfo,
      );

      if (!decodedTransaction.success) {
        console.error("❌ 트랜잭션 JWT 디코딩 실패:",
          decodedTransaction.error);
        continue;
      }

      const transactionData = decodedTransaction.data;
      console.log("📄 트랜잭션 데이터:", {
        productId: transactionData.productId,
        type: transactionData.type,
        offerType: transactionData.offerType,
        expiresDate: transactionData.expiresDate,
        revocationDate: transactionData.revocationDate,
      });

      // 🎯 구독 타입 및 상태 분석
      const isFreeTrial = transactionData.offerType === 5; // Free Trial
      const isPremium = !isFreeTrial;
      const now = Date.now();
      const expiresDate = transactionData.expiresDate ?
        parseInt(transactionData.expiresDate) : 0;
      const isExpired = expiresDate > 0 && expiresDate < now;

      // 경험 여부 업데이트
      if (isFreeTrial) {
        result.hasEverUsedTrial = true;
      }
      if (isPremium) {
        result.hasEverUsedPremium = true;
      }

      // 🎯 활성 구독 상태 확인
      if (status === 1) { // Active
        result.isActive = true;
        result.autoRenewStatus = true;
        result.expirationDate = expiresDate.toString();

        if (isFreeTrial) {
          result.planStatus = PlanStatus.TRIAL_ACTIVE;
          result.currentPlan = "trial";
        } else {
          result.planStatus = PlanStatus.PREMIUM_ACTIVE;
          result.currentPlan = "premium";
        }
      } else if (status === 2) { // Cancelled but still active
        result.isActive = !isExpired;
        result.autoRenewStatus = false;
        result.expirationDate = expiresDate.toString();

        if (isFreeTrial) {
          result.planStatus = isExpired ?
            PlanStatus.TRIAL_COMPLETED : PlanStatus.TRIAL_CANCELLED;
          result.currentPlan = isExpired ? "free" : "trial";
        } else {
          result.planStatus = isExpired ?
            PlanStatus.PREMIUM_EXPIRED : PlanStatus.PREMIUM_CANCELLED;
          result.currentPlan = isExpired ? "free" : "premium";
        }
      } else if (status === 3) { // Billing retry
        result.isActive = !isExpired;
        result.autoRenewStatus = true;
        result.expirationDate = expiresDate.toString();
        result.planStatus = PlanStatus.PREMIUM_GRACE_PERIOD;
        result.currentPlan = "premium";
      } else if (status === 4) { // Grace period
        result.isActive = true;
        result.autoRenewStatus = true;
        result.expirationDate = expiresDate.toString();
        result.planStatus = PlanStatus.PREMIUM_GRACE_PERIOD;
        result.currentPlan = "premium";
      } else if (status === 5) { // Revoked
        result.isActive = false;
        result.autoRenewStatus = false;
        result.planStatus = PlanStatus.REFUNDED;
        result.currentPlan = "free";
      }
    }

    console.log("✅ 구독 상태 분석 완료:", result);
    return result;
  } catch (error) {
    console.error("❌ 구독 상태 분석 중 오류:", error.message);
    return {
      planStatus: PlanStatus.FREE,
      currentPlan: "free",
      isActive: false,
      autoRenewStatus: false,
      error: error.message,
    };
  }
}

/**
 * 🔓 트랜잭션 JWT 디코딩
 * @param {string} signedTransaction - 서명된 트랜잭션 정보
 * @return {Promise<object>} 디코딩 결과
 */
async function decodeTransactionJWT(signedTransaction) {
  try {
    // JWT는 header.payload.signature 형태
    const parts = signedTransaction.split(".");
    if (parts.length !== 3) {
      return {
        success: false,
        error: "Invalid JWT format",
      };
    }

    // payload 부분 디코딩 (base64url)
    const payload = parts[1];
    const decodedPayload = Buffer.from(payload, "base64url").toString("utf8");
    const parsedPayload = JSON.parse(decodedPayload);

    return {
      success: true,
      data: parsedPayload,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  checkAppStoreConnect,
};
