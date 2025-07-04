// 📁 functions/utils/jwt.js - JWT 토큰 생성
const {defineSecret} = require("firebase-functions/params");
const jwt = require("jsonwebtoken");

const appstoreKeyId = defineSecret("APPSTORE_KEY_ID");
const appstoreIssuerId = defineSecret("APPSTORE_ISSUER_ID");
const appstoreBundleId = defineSecret("APPSTORE_BUNDLE_ID");
const appstorePrivateKey = defineSecret("APPSTORE_PRIVATE_KEY");

/**
 * JWT 토큰 생성 함수 (App Store Server API용)
 * @return {string} JWT 토큰
 */
function generateServerJWT() {
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

  return jwt.sign(payload, privateKey, {
    algorithm: "ES256",
    header: header,
  });
}

module.exports = {
  generateServerJWT,
  // Secrets도 export (다른 곳에서 사용할 수 있도록)
  appstoreKeyId,
  appstoreIssuerId,
  appstoreBundleId,
  appstorePrivateKey,
};
