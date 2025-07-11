// 📁 functions/index.js - 메인 엔트리포인트
const admin = require("firebase-admin");

// Firebase Admin 초기화
admin.initializeApp();

const {subCheckSubscriptionStatus} = require(
  "./subscription/checkSubscriptionStatus.js",
);
const {appStoreNotifications} = require("./webhook/appStoreNotifications");
const {extractOriginalTransactionId} = require(
  "./subscription/extractOriginalTransactionId.js",
);

// 구독 관련 함수들
exports.sub_checkSubscriptionStatus = subCheckSubscriptionStatus;
exports.extractOriginalTransactionId = extractOriginalTransactionId;

// 웹훅 함수들
exports.appStoreNotifications = appStoreNotifications;
