// 📁 functions/src/utils/appStoreServerClient.js
// Apple 공식 라이브러리 기반 클라이언트
const {AppStoreServerAPIClient, Environment} = require(
  "@apple/app-store-server-library",
);
const {defineSecret} = require("firebase-functions/params");

// Firebase Secrets 정의
const appstoreKeyId = defineSecret("APPSTORE_KEY_ID");
const appstoreIssuerId = defineSecret("APPSTORE_ISSUER_ID");
const appstoreBundleId = defineSecret("APPSTORE_BUNDLE_ID");
const appstorePrivateKey = defineSecret("APPSTORE_PRIVATE_KEY");

/**
 * 🚀 Apple 공식 App Store Server API Client 싱글톤
 *
 * ✅ 장점:
 * - 자동 JWT 토큰 관리
 * - 에러 처리 자동화
 * - 타입 안전성 보장
 * - Apple 업데이트 자동 호환
 */
class AppStoreServerClient {
  /**
   * 생성자
   */
  constructor() {
    this._client = null;
    this._isInitialized = false;
  }

  /**
   * Client 초기화 (Lazy Initialization)
   * @return {object} 초기화된 클라이언트
   */
  initialize() {
    if (this._isInitialized) {
      return this._client;
    }

    try {
      const keyId = appstoreKeyId.value();
      const issuerId = appstoreIssuerId.value();
      const privateKey = appstorePrivateKey.value();
      const bundleId = appstoreBundleId.value();

      console.log("🔧 App Store Server Client 초기화:");
      console.log("  - Key ID:", keyId ? "✅" : "❌");
      console.log("  - Issuer ID:", issuerId ? "✅" : "❌");
      console.log("  - Bundle ID:", bundleId ? "✅" : "❌");
      console.log("  - Private Key:", privateKey ? "✅" : "❌");

      if (!keyId || !issuerId || !privateKey || !bundleId) {
        throw new Error("App Store Server API 환경 변수가 설정되지 않았습니다");
      }

      // 🚀 Apple 공식 Client 생성
      this._client = new AppStoreServerAPIClient(
        privateKey,
        keyId,
        issuerId,
        bundleId,
        Environment.PRODUCTION, // Production 환경 (Sandbox용은 Environment.SANDBOX)
      );

      this._isInitialized = true;
      console.log("✅ Apple App Store Server Client 초기화 완료");

      return this._client;
    } catch (error) {
      console.error("❌ App Store Server Client 초기화 실패:", error.message);
      throw error;
    }
  }

  /**
   * 🎯 Transaction 정보 조회 (공식 라이브러리 사용)
   * @param {string} transactionId - 트랜잭션 ID
   * @return {Promise<object>} 조회 결과
   */
  async getTransactionInfo(transactionId) {
    try {
      console.log("🔍 Transaction 정보 조회 시작:", transactionId);

      const client = this.initialize();

      // 🚀 공식 라이브러리로 Transaction 정보 조회
      const response = await client.getTransactionInfo(transactionId);

      if (response && response.signedTransactionInfo) {
        console.log("✅ Transaction 정보 조회 성공");
        return {
          success: true,
          data: response,
        };
      } else {
        console.error("❌ Transaction 정보가 없음");
        return {
          success: false,
          error: "No transaction info in response",
        };
      }
    } catch (error) {
      console.error("❌ Transaction 정보 조회 실패:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 🎯 구독 상태 조회 (공식 라이브러리 사용)
   * @param {string} originalTransactionId - 원본 트랜잭션 ID
   * @return {Promise<object>} 조회 결과
   */
  async getSubscriptionStatus(originalTransactionId) {
    try {
      console.log("🔍 구독 상태 조회 시작:", originalTransactionId);

      const client = this.initialize();

      // 🚀 공식 라이브러리로 구독 상태 조회
      const response = await client.getSubscriptionStatus(
        originalTransactionId,
      );

      if (response && response.data) {
        console.log("✅ 구독 상태 조회 성공");
        return {
          success: true,
          data: response.data,
        };
      } else {
        console.error("❌ 구독 상태 정보가 없음");
        return {
          success: false,
          error: "No subscription status in response",
        };
      }
    } catch (error) {
      console.error("❌ 구독 상태 조회 실패:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 🎯 Transaction History 조회 (공식 라이브러리 사용)
   * @param {string} originalTransactionId - 원본 트랜잭션 ID
   * @return {Promise<object>} 조회 결과
   */
  async getTransactionHistory(originalTransactionId) {
    try {
      console.log("🔍 Transaction History 조회 시작:", originalTransactionId);

      const client = this.initialize();

      // 🚀 공식 라이브러리로 Transaction History 조회
      const response = await client.getTransactionHistory(
        originalTransactionId,
      );

      if (response && response.signedTransactions) {
        console.log("✅ Transaction History 조회 성공");
        return {
          success: true,
          data: response,
        };
      } else {
        console.error("❌ Transaction History가 없음");
        return {
          success: false,
          error: "No transaction history in response",
        };
      }
    } catch (error) {
      console.error("❌ Transaction History 조회 실패:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

// 싱글톤 인스턴스
const appStoreServerClient = new AppStoreServerClient();

module.exports = {
  appStoreServerClient,
  // Secrets export (기존 호환성 유지)
  appstoreKeyId,
  appstoreIssuerId,
  appstoreBundleId,
  appstorePrivateKey,
};
