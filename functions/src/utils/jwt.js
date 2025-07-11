// 📁 functions/utils/jwt.js
// Apple 공식 라이브러리와 호환되는 JWT 유틸리티
const {defineSecret} = require("firebase-functions/params");

// Firebase Secrets 정의
const appstoreKeyId = defineSecret("APPSTORE_KEY_ID");
const appstoreIssuerId = defineSecret("APPSTORE_ISSUER_ID");
const appstoreBundleId = defineSecret("APPSTORE_BUNDLE_ID");
const appstorePrivateKey = defineSecret("APPSTORE_PRIVATE_KEY");

/**
 * ⚠️ DEPRECATED: 수동 JWT 생성 함수
 *
 * 🚨 이 함수는 더 이상 권장되지 않습니다!
 * 대신 Apple 공식 라이브러리 사용을 권장합니다:
 * ../utils/appStoreServerClient.js
 *
 * 🎯 마이그레이션 가이드:
 * 기존: const token = generateServerJWT();
 * 신규: const client = appStoreServerClient.initialize();
 *      const result = await client.getTransactionInfo(transactionId);
 *
 * @deprecated Use appStoreServerClient instead
 * @return {string} JWT 토큰
 */
function generateServerJWT() {
  console.warn("⚠️ [DEPRECATED] generateServerJWT() 사용 중!");
  console.warn("   → Apple 공식 라이브러리 사용을 권장합니다: " +
    "appStoreServerClient");
  console.warn("   → 자세한 정보: ../utils/appStoreServerClient.js");

  try {
    // 레거시 지원을 위한 JWT 라이브러리 동적 로드
    const jwt = require("jsonwebtoken");

    const keyId = appstoreKeyId.value();
    const issuerId = appstoreIssuerId.value();
    const privateKey = appstorePrivateKey.value();
    const bundleId = appstoreBundleId.value();

    if (!keyId || !issuerId || !privateKey || !bundleId) {
      throw new Error("App Store Server API 환경 변수가 설정되지 않았습니다");
    }

    const now = Math.floor(Date.now() / 1000);

    const payload = {
      iss: issuerId,
      iat: now,
      exp: now + 3600, // 1시간 후 만료
      aud: "appstoreconnect-v1",
      bid: bundleId,
    };

    const header = {
      alg: "ES256",
      kid: keyId,
      typ: "JWT",
    };

    console.log("🔧 [DEPRECATED] 수동 JWT 생성 중...");

    return jwt.sign(payload, privateKey, {
      algorithm: "ES256",
      header: header,
    });
  } catch (error) {
    console.error("❌ [DEPRECATED] JWT 생성 실패:", error.message);
    throw new Error("JWT 생성 실패: " + error.message);
  }
}

/**
 * 🚀 Apple 공식 라이브러리 마이그레이션 헬퍼
 *
 * 기존 코드를 Apple 공식 라이브러리로 쉽게 마이그레이션할 수 있도록
 * 도와주는 함수
 * @return {object} 마이그레이션 정보
 */
function getMigrationGuide() {
  return {
    message: "Apple 공식 App Store Server Library로 마이그레이션하세요!",
    benefits: [
      "✅ 자동 JWT 토큰 관리",
      "✅ 에러 처리 자동화",
      "✅ 타입 안전성 보장",
      "✅ Apple 업데이트 자동 호환",
      "✅ 재시도 로직 내장",
    ],
    migration: {
      before: "const token = generateServerJWT(); " +
        "const response = await axios.get(url, " +
        "{headers: {'Authorization': 'Bearer ' + token}});",
      after: "const client = appStoreServerClient.initialize(); " +
        "const result = await client.getTransactionInfo(transactionId);",
    },
    files: {
      newClient: "../utils/appStoreServerClient.js",
      examples: [
        "../subscription/extractOriginalTransactionId.js",
        "../subscription/appStoreConnectService.js",
      ],
    },
  };
}

/**
 * 🎯 설정 정보 유틸리티 (공식 라이브러리와 공유)
 * @return {object|null} 설정 정보
 */
function getAppStoreConfig() {
  try {
    return {
      keyId: appstoreKeyId.value(),
      issuerId: appstoreIssuerId.value(),
      bundleId: appstoreBundleId.value(),
      hasPrivateKey: !!appstorePrivateKey.value(),
    };
  } catch (error) {
    console.error("❌ App Store 설정 로드 실패:", error.message);
    return null;
  }
}

/**
 * 🔍 설정 검증 유틸리티
 * @return {object} 검증 결과
 */
function validateAppStoreConfig() {
  const config = getAppStoreConfig();

  if (!config) {
    return {
      isValid: false,
      errors: ["설정 로드 실패"],
    };
  }

  const errors = [];

  if (!config.keyId) errors.push("APPSTORE_KEY_ID 누락");
  if (!config.issuerId) errors.push("APPSTORE_ISSUER_ID 누락");
  if (!config.bundleId) errors.push("APPSTORE_BUNDLE_ID 누락");
  if (!config.hasPrivateKey) errors.push("APPSTORE_PRIVATE_KEY 누락");

  return {
    isValid: errors.length === 0,
    errors: errors,
    config: config,
  };
}

module.exports = {
  // 🚨 DEPRECATED 함수 (하위 호환성을 위해 유지)
  generateServerJWT,

  // 🚀 새로운 유틸리티 함수들
  getMigrationGuide,
  getAppStoreConfig,
  validateAppStoreConfig,

  // Secrets export (다른 곳에서 사용할 수 있도록)
  appstoreKeyId,
  appstoreIssuerId,
  appstoreBundleId,
  appstorePrivateKey,
};
