// 📁 functions/index.js - 메인 엔트리포인트
const admin = require("firebase-admin");

// Firebase Admin 초기화
admin.initializeApp();

const {subCheckSubscriptionStatus} = require("./subscription/checkSubscriptionStatus");
const {appStoreNotifications} = require("./webhook/appStoreNotifications");
const {syncPurchaseInfo} = require("./subscription/syncPurchaseInfo");

// 🎯 구독 관련 함수들
exports.subCheckSubscriptionStatus = subCheckSubscriptionStatus;
exports.syncPurchaseInfo = syncPurchaseInfo;

// 웹훅 함수들
exports.appStoreNotifications = appStoreNotifications;
