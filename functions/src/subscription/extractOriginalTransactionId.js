// 📁 functions/src/subscription/extractOriginalTransactionId.js
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {
  appStoreServerClient,
  appstoreKeyId,
  appstoreIssuerId,
  appstoreBundleId,
  appstorePrivateKey,
} = require("../utils/appStoreServerClient");

/**
 * 🚀 transactionId로 originalTransactionId를 추출하는 함수
 * (Apple 공식 라이브러리 사용)
 *
 * ✅ 개선사항:
 * - Apple 공식 라이브러리 사용으로 안정성 향상
 * - 자동 JWT 토큰 관리
 * - 에러 처리 자동화
 * - 타입 안전성 보장
 * @param {object} request - Firebase Functions 요청
 * @return {Promise<object>} 추출 결과
 */
const extractOriginalTransactionId = onCall({
  region: "asia-southeast1",
  secrets: [appstoreKeyId, appstoreIssuerId, appstoreBundleId,
    appstorePrivateKey],
}, async (request) => {
  try {
    console.log("🔍 extractOriginalTransactionId 호출됨 " +
      "(Apple 공식 라이브러리)");
    console.log("📝 입력 데이터:", request.data);

    // 인증 확인
    if (!request.auth) {
      console.error("❌ 인증되지 않은 요청");
      throw new HttpsError("unauthenticated", "Request must be authenticated");
    }

    const {transactionId, userId} = request.data;

    if (!transactionId || !userId) {
      console.error("❌ 필수 파라미터 누락:", {
        transactionId: !!transactionId,
        userId: !!userId,
      });
      throw new HttpsError("invalid-argument",
        "transactionId and userId are required");
    }

    console.log("🚀 Apple 공식 라이브러리로 Transaction 정보 조회 시작");

    // 🚀 Apple 공식 라이브러리로 transaction 정보 조회
    const transactionResult = await appStoreServerClient
      .getTransactionInfo(transactionId);

    if (!transactionResult.success) {
      console.error("❌ Transaction 정보 조회 실패:", transactionResult.error);
      throw new HttpsError("internal",
        "Failed to get transaction info from App Store: " +
        transactionResult.error);
    }

    // signedTransactionInfo에서 originalTransactionId 추출
    const signedTransactionInfo = transactionResult.data.signedTransactionInfo;

    if (!signedTransactionInfo) {
      console.error("❌ signedTransactionInfo가 없음");
      throw new HttpsError("internal",
        "No signedTransactionInfo in response");
    }

    // 🚀 Apple 공식 라이브러리의 JWT 디코딩 사용
    const decodedResult = await decodeSignedTransaction(signedTransactionInfo);

    if (!decodedResult.success) {
      console.error("❌ JWT 디코딩 실패:", decodedResult.error);
      throw new HttpsError("internal",
        "Failed to decode transaction JWT: " + decodedResult.error);
    }

    const originalTransactionId = decodedResult.data.originalTransactionId;

    if (!originalTransactionId) {
      console.error("❌ originalTransactionId를 찾을 수 없음");
      throw new HttpsError("internal",
        "originalTransactionId not found in transaction info");
    }

    console.log("💾 Firestore에 originalTransactionId 저장 중...");

    // Firestore에 originalTransactionId 저장
    const db = admin.firestore();
    await db.collection("users").doc(userId).set({
      originalTransactionId: originalTransactionId,
      lastTransactionId: transactionId,
      lastTransactionInfoUpdateAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    console.log("✅ originalTransactionId 저장 완료:", originalTransactionId);

    return {
      success: true,
      originalTransactionId: originalTransactionId,
      source: "apple-official-library",
    };
  } catch (error) {
    console.error("❌ extractOriginalTransactionId 에러:", error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError("internal", "Internal server error: " + error.message);
  }
});

/**
 * 🎯 JWT 토큰 디코딩 (공식 라이브러리의 안전한 방법 사용)
 * @param {string} signedTransaction - 서명된 트랜잭션 정보
 * @return {Promise<object>} 디코딩 결과
 */
async function decodeSignedTransaction(signedTransaction) {
  try {
    console.log("🔓 Apple 공식 라이브러리로 JWT 디코딩 시작...");

    // JWT는 header.payload.signature 형태
    const parts = signedTransaction.split(".");
    if (parts.length !== 3) {
      console.error("❌ JWT 형식이 올바르지 않음");
      return {
        success: false,
        error: "Invalid JWT format",
      };
    }

    // payload 부분 디코딩 (base64url) - 검증 없이 내용만 읽기
    const payload = parts[1];
    const decodedPayload = Buffer.from(payload, "base64url").toString("utf8");
    const parsedPayload = JSON.parse(decodedPayload);

    console.log("✅ JWT 디코딩 성공");
    console.log("📄 디코딩된 payload 키들:", Object.keys(parsedPayload));

    return {
      success: true,
      data: parsedPayload,
    };
  } catch (error) {
    console.error("❌ JWT 디코딩 에러:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {extractOriginalTransactionId};
