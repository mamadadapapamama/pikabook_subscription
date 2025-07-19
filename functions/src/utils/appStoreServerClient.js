// 📁 functions/src/utils/appStoreServerClient.js
// Apple 공식 라이브러리 기반 클라이언트
const {AppStoreServerAPIClient, Environment} = require(
  "@apple/app-store-server-library",
);
const {defineSecret} = require("firebase-functions/params");

// 🎯 App Store Connect API Secrets (구독 상태 조회, 트랜잭션 히스토리)
const appstoreConnectKeyId = defineSecret("APPSTORE_CONNECT_KEY_ID"); // 2J557N73ZA
const appstoreConnectIssuerId = defineSecret("APPSTORE_CONNECT_ISSUER_ID"); // 동일
const appstoreConnectPrivateKey = defineSecret("APPSTORE_CONNECT_PRIVATE_KEY"); // Connect용 키
const appstoreConnectBundleId = defineSecret("APPSTORE_CONNECT_BUNDLE_ID"); // 동일
const appstoreConnectEnvironment = defineSecret("APPSTORE_CONNECT_ENVIRONMENT"); // 동일

// 🎯 In-App Purchase API Secrets (JWS 검증, 프로모션 오퍼)
const iapKeyId = defineSecret("IAP_KEY_ID"); // D358HVX9AF
const iapIssuerId = defineSecret("IAP_ISSUER_ID"); // 동일
const iapPrivateKey = defineSecret("IAP_PRIVATE_KEY"); // IAP용 키
const iapBundleId = defineSecret("IAP_BUNDLE_ID"); // 동일
const iapEnvironment = defineSecret("IAP_ENVIRONMENT"); // 동일

/**
 * 🚀 App Store Connect API Client (구독 상태 조회, 트랜잭션 히스토리)
 *
 * 사용처:
 * - checkSubscriptionStatus.js
 * - appStoreNotifications.js
 */
class AppStoreConnectClient {
  constructor() {
    this._client = null;
    this._isInitialized = false;
  }

  initialize() {
    if (this._isInitialized) {
      return this._client;
    }

    try {
      const keyId = appstoreConnectKeyId.value();
      const issuerId = appstoreConnectIssuerId.value();
      const privateKey = appstoreConnectPrivateKey.value();
      const bundleId = appstoreConnectBundleId.value();
      const environment = appstoreConnectEnvironment.value() || "sandbox";

      console.log("🔧 App Store Connect API Client 초기화:");
      console.log("  - Key ID:", keyId ? "✅" : "❌");
      console.log("  - Issuer ID:", issuerId ? "✅" : "❌");
      console.log("  - Bundle ID:", bundleId ? "✅" : "❌");
      console.log("  - Private Key:", privateKey ? "✅" : "❌");
      console.log("  - Environment:", environment ? "✅" : "❌");

      if (!keyId || !issuerId || !privateKey || !bundleId) {
        throw new Error("App Store Connect API 환경 변수가 설정되지 않았습니다");
      }

      const appStoreEnvironment = environment === "production" ?
        Environment.PRODUCTION : Environment.SANDBOX;

      console.log(`🌍 App Store Connect 환경: ${environment} (${appStoreEnvironment})`);

      this._client = new AppStoreServerAPIClient(
        privateKey,
        keyId,
        issuerId,
        bundleId,
        appStoreEnvironment,
      );

      this._isInitialized = true;
      console.log("✅ App Store Connect API Client 초기화 완료");

      return this._client;
    } catch (error) {
      console.error("❌ App Store Connect API Client 초기화 실패:", error.message);
      throw error;
    }
  }

  async getSubscriptionStatus(originalTransactionId) {
    try {
      console.log("🔍 [Connect] 구독 상태 조회 시작:", originalTransactionId);
      const client = this.initialize();

      const response = await client.getAllSubscriptionStatuses(originalTransactionId);

      if (response && response.data) {
        console.log("✅ [Connect] 구독 상태 조회 성공");
        return {
          success: true,
          data: response.data,
        };
      } else {
        console.error("❌ [Connect] 구독 상태 정보가 없음");
        return {
          success: false,
          error: "No subscription status in response",
        };
      }
    } catch (error) {
      console.error("❌ [Connect] 구독 상태 조회 실패:", error.message);
      return {
        success: false,
        error: error.message || error.toString(),
      };
    }
  }

  async getTransactionHistory(originalTransactionId) {
    try {
      console.log("🔍 [Connect] Transaction History 조회 시작:", originalTransactionId);
      const client = this.initialize();

      const response = await client.getTransactionHistory(
        originalTransactionId,
        null, // revisionToken
        {}, // transactionHistoryRequest
      );

      if (response && response.signedTransactions) {
        console.log("✅ [Connect] Transaction History 조회 성공");
        return {
          success: true,
          data: response,
        };
      } else {
        console.error("❌ [Connect] Transaction History가 없음");
        return {
          success: false,
          error: "No transaction history in response",
        };
      }
    } catch (error) {
      console.error("❌ [Connect] Transaction History 조회 실패 - 상세 정보:");
      console.error("  - Error Type:", typeof error);
      console.error("  - Error Message:", error.message || "No message");
      console.error("  - Error Code:", error.code || "No code");
      console.error("  - Error Stack:", error.stack || "No stack");
      console.error("  - Full Error:", JSON.stringify(error, null, 2));

      // Apple API 에러 구조 확인
      if (error.httpStatusCode) {
        console.error("  - HTTP Status Code:", error.httpStatusCode);
      }
      if (error.apiError) {
        console.error("  - API Error:", error.apiError);
      }
      if (error.errorMessage) {
        console.error("  - Error Message:", error.errorMessage);
      }

      return {
        success: false,
        error: error.message || error.toString() || "Unknown error",
      };
    }
  }

  async getTransactionInfo(transactionId) {
    try {
      console.log("🔍 [Connect] Transaction 정보 조회 시작:", transactionId);
      const client = this.initialize();

      const response = await client.getTransactionInfo(transactionId);

      if (response && response.signedTransactionInfo) {
        console.log("✅ [Connect] Transaction 정보 조회 성공");
        return {
          success: true,
          data: response,
        };
      } else {
        console.error("❌ [Connect] Transaction 정보가 없음");
        return {
          success: false,
          error: "No transaction info in response",
        };
      }
    } catch (error) {
      console.error("❌ [Connect] Transaction 정보 조회 실패:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async verifyAndDecodeJWS(jws) {
    try {
      const client = this.initialize();
      const verificationResult = await client.verifyAndDecodeNotification(jws);
      return {success: true, data: verificationResult};
    } catch (error) {
      console.error("❌ [Connect] JWS 검증 실패:", error.message);
      return {success: false, error: error.message};
    }
  }
}

/**
 * 🚀 In-App Purchase API Client (JWS 검증, 프로모션 오퍼)
 *
 * 사용처:
 * - syncPurchaseInfo.js
 */
class InAppPurchaseClient {
  constructor() {
    this._client = null;
    this._isInitialized = false;
  }

  initialize() {
    if (this._isInitialized) {
      return this._client;
    }

    try {
      const keyId = iapKeyId.value();
      const issuerId = iapIssuerId.value();
      const privateKey = iapPrivateKey.value();
      const bundleId = iapBundleId.value();
      const environment = iapEnvironment.value() || "sandbox";

      console.log("🔧 In-App Purchase API Client 초기화:");
      console.log("  - Key ID:", keyId ? "✅" : "❌");
      console.log("  - Issuer ID:", issuerId ? "✅" : "❌");
      console.log("  - Bundle ID:", bundleId ? "✅" : "❌");
      console.log("  - Private Key:", privateKey ? "✅" : "❌");
      console.log("  - Environment:", environment ? "✅" : "❌");

      if (!keyId || !issuerId || !privateKey || !bundleId) {
        throw new Error("In-App Purchase API 환경 변수가 설정되지 않았습니다");
      }

      const appStoreEnvironment = environment === "production" ?
        Environment.PRODUCTION : Environment.SANDBOX;

      console.log(`🌍 In-App Purchase 환경: ${environment} (${appStoreEnvironment})`);

      this._client = new AppStoreServerAPIClient(
        privateKey,
        keyId,
        issuerId,
        bundleId,
        appStoreEnvironment,
      );

      this._isInitialized = true;
      console.log("✅ In-App Purchase API Client 초기화 완료");

      return this._client;
    } catch (error) {
      console.error("❌ In-App Purchase API Client 초기화 실패:", error.message);
      throw error;
    }
  }

  async verifyJWS(jwsRepresentation) {
    try {
      console.log("🔐 [IAP] JWS 트랜잭션 검증 및 디코딩 시작");
      const client = this.initialize();
      // 🔥 수정: 올바른 함수 이름인 decodeTransaction() 사용
      const decodedTransaction = await client.decodeTransaction(jwsRepresentation);

      console.log("✅ [IAP] JWS 트랜잭션 검증 및 디코딩 성공");
      return {
        success: true,
        data: decodedTransaction,
      };
    } catch (error) {
      console.error("❌ [IAP] JWS 검증 실패:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async verifyAndDecodeJWS(jws) {
    try {
      const client = this.initialize();
      // 🔥 수정: 올바른 함수 이름인 decodeTransaction() 사용
      const verificationResult = await client.verifyAndDecodeNotification(jws)
        .catch(() => client.decodeTransaction(jws));
      
      return { success: true, data: verificationResult };
    } catch (error) {
      console.error("❌ [IAP] JWS 검증 실패:", error.message);
      return { success: false, error: error.message };
    }
  }
}

// 🎯 appStoreServerClient 인스턴스 생성
const appStoreServerClient = new AppStoreConnectClient();
const inAppPurchaseClient = new InAppPurchaseClient();

// JWS 디코딩만 하는 함수 (클래스 외부로 이동)
function decodeJWS(jwsRepresentation) {
  try {
    const parts = jwsRepresentation.split(".");
    if (parts.length !== 3) return null;

    const payload = parts[1];
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    return JSON.parse(decoded);
  } catch (error) {
    console.error("JWS 디코딩 실패:", error);
    return null;
  }
}

module.exports = {
  // 🎯 새로운 분리된 클라이언트들
  appStoreServerClient,
  inAppPurchaseClient,
  
  // 🎯 App Store Connect API Secrets
  appstoreConnectKeyId,
  appstoreConnectIssuerId,
  appstoreConnectPrivateKey,
  appstoreConnectBundleId,
  appstoreConnectEnvironment,
  
  // 🎯 In-App Purchase API Secrets  
  iapKeyId,
  iapIssuerId,
  iapPrivateKey,
  iapBundleId,
  iapEnvironment,
  
  // 🎯 기존 호환성 유지 (Connect API 사용)
  appstoreKeyId: appstoreConnectKeyId,
  appstoreIssuerId: appstoreConnectIssuerId,
  appstorePrivateKey: appstoreConnectPrivateKey,
  appstoreBundleId: appstoreConnectBundleId,
  appstoreEnvironment: appstoreConnectEnvironment,
  decodeJWS, // 외부에서 사용할 수 있도록 export
};
