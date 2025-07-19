// 📁 functions/src/utils/appStoreServerClient.js
// Apple 공식 라이브러리 기반 클라이언트
const {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier, // ⭐️ SignedDataVerifier import
  VerificationException, // ⭐️ VerificationException import
} = require("@apple/app-store-server-library");
const {defineSecret} = require("firebase-functions/params");

// Secret Manager에서 환경 변수 로드
const iapKeyId = defineSecret("APP_STORE_KEY_ID");
const iapIssuerId = defineSecret("APP_STORE_ISSUER_ID");
const iapBundleId = defineSecret("APP_STORE_BUNDLE_ID");
// PKCS#8 형식의 private key를 base64로 인코딩하여 Secret Manager에 저장해야 합니다.
const iapPrivateKeyBase64 = defineSecret("APP_STORE_PRIVATE_KEY_BASE64");
const iapEnvironment = defineSecret("APP_STORE_ENVIRONMENT");
// Apple Root CA 인증서들을 base64로 인코딩하여 Secret Manager에 저장해야 합니다.
const appleRootCert1 = defineSecret("APPLE_ROOT_CA_G1_BASE64");
const appleRootCert2 = defineSecret("APPLE_ROOT_CA_G2_BASE64");
const appleRootCert3 = defineSecret("APPLE_ROOT_CA_G3_BASE64");

/**
 * 🚀 App Store와 통신하고 JWS를 검증하는 통합 클라이언트
 *
 * 이 클래스는 다음 두 가지 역할을 모두 수행합니다.
 * 1. AppStoreServerAPIClient: 구독 상태, 거래 내역 조회 등 API 통신
 * 2. SignedDataVerifier: 클라이언트로부터 받은 JWS(signedTransaction) 검증
 */
class InAppPurchaseClient {
  constructor() {
    this._client = null;
    this._verifier = null; // ⭐️ Verifier 인스턴스를 저장할 속성
    this._isInitialized = false;
  }

  /**
   * Secret Manager에서 값을 읽어와 클라이언트와 검증기를 초기화합니다.
   * 모든 외부 호출 메서드 시작 부분에서 호출하여 초기화를 보장합니다.
   */
  initialize() {
    if (this._isInitialized) {
      return;
    }

    try {
      // Secret 값 로드
      const keyId = iapKeyId.value();
      const issuerId = iapIssuerId.value();
      const bundleId = iapBundleId.value();
      const privateKeyBase64 = iapPrivateKeyBase64.value();
      const environment = iapEnvironment.value() || "sandbox";
      const cert1Base64 = appleRootCert1.value();
      const cert2Base64 = appleRootCert2.value();
      const cert3Base64 = appleRootCert3.value();

      console.log("🔧 In-App Purchase 통합 클라이언트 초기화:");
      console.log("  - Key ID:", keyId ? "✅" : "❌");
      console.log("  - Issuer ID:", issuerId ? "✅" : "❌");
      console.log("  - Bundle ID:", bundleId ? "✅" : "❌");
      console.log("  - Private Key:", privateKeyBase64 ? "✅" : "❌");
      console.log("  - Environment:", environment ? "✅" : "❌");
      console.log("  - Apple Root CA G1:", cert1Base64 ? "✅" : "❌");
      console.log("  - Apple Root CA G2:", cert2Base64 ? "✅" : "❌");
      console.log("  - Apple Root CA G3:", cert3Base64 ? "✅" : "❌");


      if (!keyId || !issuerId || !privateKeyBase64 || !bundleId ||
          !cert1Base64 || !cert2Base64 || !cert3Base64) {
        throw new Error("App Store Connect API 또는 인증서 환경 변수가 설정되지 않았습니다.");
      }

      // Base64 디코딩
      const privateKey = Buffer.from(privateKeyBase64, "base64").toString("utf8");
      const appleRootCerts = [
        Buffer.from(cert1Base64, "base64"),
        Buffer.from(cert2Base64, "base64"),
        Buffer.from(cert3Base64, "base64"),
      ];

      const appStoreEnvironment = environment === "production" ?
        Environment.PRODUCTION : Environment.SANDBOX;

      console.log(`🌍 In-App Purchase 환경: ${environment} (${appStoreEnvironment})`);

      // 1. API 클라이언트 초기화
      this._client = new AppStoreServerAPIClient(
          privateKey,
          keyId,
          issuerId,
          bundleId,
          appStoreEnvironment,
      );

      // 2. ⭐️ JWS Verifier 초기화
      this._verifier = new SignedDataVerifier(
          appleRootCerts,
          true, // enableOnlineChecks
          appStoreEnvironment,
          bundleId,
      );

      this._isInitialized = true;
      console.log("✅ In-App Purchase 통합 클라이언트 초기화 완료");
    } catch (error) {
      console.error("❌ In-App Purchase 통합 클라이언트 초기화 실패:", error.message);
      // 초기화 실패 시에는 에러를 던져서 상위에서 처리하도록 함
      throw error;
    }
  }

  /**
   * ⭐️ JWS(signedTransaction)를 검증하고 디코딩합니다.
   * syncPurchaseInfo 함수에서 사용됩니다.
   * @param {string} jwsRepresentation - The signedTransaction from the client.
   * @returns {Promise<{success: boolean, data?: object, error?: string}>}
   */
  async verifyJWS(jwsRepresentation) {
    try {
      this.initialize(); // 초기화 보장
      console.log("🔐 [IAP] JWS 트랜잭션 검증 및 디코딩 시작");

      if (!this._verifier) {
        throw new Error("Verifier가 초기화되지 않았습니다. 초기화 로직을 확인하세요.");
      }

      // ⭐️ _verifier 인스턴스의 메서드 사용
      const decodedTransaction =
        await this._verifier.verifyAndDecodeTransaction(jwsRepresentation);

      console.log("✅ [IAP] JWS 트랜잭션 검증 및 디코딩 성공");
      return {
        success: true,
        data: decodedTransaction,
      };
    } catch (error) {
      if (error instanceof VerificationException) {
        console.error(`❌ [IAP] JWS 검증 실패 (VerificationException): ${error.message} (Status: ${error.status})`);
      } else {
        console.error("❌ [IAP] JWS 검증 중 알 수 없는 오류:", error.message);
      }
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  /**
   * App Store 서버 알림(signedPayload)을 검증하고 디코딩합니다.
   * webhook에서 사용됩니다.
   * @param {string} signedPayload - The signedPayload from App Store Server Notification.
   * @returns {Promise<{success: boolean, data?: object, error?: string}>}
   */
  async verifySignedPayload(signedPayload) {
    try {
      this.initialize(); // 초기화 보장
      if (!this._verifier) {
        throw new Error("Verifier가 초기화되지 않았습니다.");
      }
      
      const decodedData = await this._verifier.verifyAndDecodeNotification(signedPayload);
      return { success: true, data: decodedData };
    } catch (error) {
      if (error instanceof VerificationException) {
         console.error(`❌ [IAP] 알림 페이로드 검증 실패: ${error.message} (Status: ${error.status})`);
      } else {
         console.error("❌ [IAP] 알림 페이로드 검증 중 알 수 없는 오류:", error.message);
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * 사용자의 전체 거래 내역을 조회합니다.
   * @param {string} originalTransactionId
   * @returns {Promise<{success: boolean, data?: object, error?: string}>}
   */
  async getTransactionHistory(originalTransactionId) {
    try {
      this.initialize(); // 초기화 보장
      console.log("🔍 [Connect] Transaction History 조회 시작:", originalTransactionId);

      const response = await this._client.getTransactionHistory(originalTransactionId);
      
      console.log("✅ [Connect] Transaction History 조회 성공");
      return {
        success: true,
        data: response,
      };
    } catch (error) {
      return this.handleApiError(error, "Transaction History 조회");
    }
  }

  /**
   * 특정 거래 정보를 조회합니다.
   * @param {string} transactionId
   * @returns {Promise<{success: boolean, data?: object, error?: string}>}
   */
  async getTransactionInfo(transactionId) {
    try {
      this.initialize(); // 초기화 보장
      console.log("🔍 [Connect] Transaction 정보 조회 시작:", transactionId);
      
      const response = await this._client.getTransactionInfo(transactionId);

      console.log("✅ [Connect] Transaction 정보 조회 성공");
      return {
        success: true,
        data: response,
      };
    } catch (error) {
      return this.handleApiError(error, "Transaction 정보 조회");
    }
  }

  /**
   * API 호출에서 발생하는 에러를 공통으로 처리합니다.
   * @param {Error} error - The error object.
   * @param {string} context - The context of the API call.
   * @returns {{success: false, error: string}}
   */
  handleApiError(error, context) {
    console.error(`❌ [Connect] ${context} 실패:`, error.message);
    // Apple API 에러는 httpStatusCode와 apiError 필드를 포함할 수 있습니다.
    if (error.httpStatusCode) {
      console.error(`  - HTTP Status: ${error.httpStatusCode}`);
    }
    if (error.apiError) {
      console.error(`  - API Error Code: ${error.apiError}`);
    }
    return {
      success: false,
      error: `Apple API Error in ${context}: ${error.message}`,
    };
  }
}

// 싱글톤 인스턴스를 생성하여 export
const iapClient = new InAppPurchaseClient();

module.exports = {
  iapClient,
};
