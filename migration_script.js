// 📁 migration_script.js
// 🔄 Firestore 데이터 구조 마이그레이션 스크립트

const admin = require("firebase-admin");

// ⚠️ 중요: 실제 서비스 계정 키 파일 경로로 수정해야 합니다
// 예시: const serviceAccount = require("./path/to/your/serviceAccountKey.json");

// 로컬 개발용 (실제 경로로 수정 필요)
// const serviceAccount = require("./serviceAccountKey.json");

// 또는 환경 변수 사용 (권장)
if (!admin.apps.length) {
  admin.initializeApp({
    // credential: admin.credential.cert(serviceAccount), // 서비스 계정 키 파일 사용 시
    // 또는 환경 변수 사용 (GOOGLE_APPLICATION_CREDENTIALS 설정 시)
  });
}

const db = admin.firestore();

/**
 * 🔄 데이터 구조 마이그레이션 메인 함수
 */
async function migrateSubscriptionData() {
  try {
    console.log("🚀 구독 데이터 구조 마이그레이션 시작...");
    console.log("⏰ 시작 시간:", new Date().toISOString());

    const usersRef = db.collection("users");
    const snapshot = await usersRef.get();

    if (snapshot.empty) {
      console.log("🤷‍♀️ 마이그레이션할 사용자가 없습니다.");
      return;
    }

    console.log(`📊 총 ${snapshot.size}개의 사용자 문서를 검사합니다.`);

    let processedCount = 0;
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // 배치 처리
    const BATCH_SIZE = 100;
    const batches = [];
    
    for (let i = 0; i < snapshot.docs.length; i += BATCH_SIZE) {
      const batch = snapshot.docs.slice(i, i + BATCH_SIZE);
      batches.push(batch);
    }

    console.log(`📦 ${batches.length}개의 배치로 처리합니다.`);

    // 각 배치 처리
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`\n🔄 배치 ${batchIndex + 1}/${batches.length} 처리 중...`);

      const promises = batch.map(doc => migrateSingleUser(doc));
      const results = await Promise.allSettled(promises);

      results.forEach((result, index) => {
        processedCount++;
        if (result.status === 'fulfilled') {
          if (result.value.migrated) {
            migratedCount++;
          } else {
            skippedCount++;
          }
        } else {
          errorCount++;
          console.error(`❌ 사용자 ${batch[index].id} 마이그레이션 실패:`, result.reason);
        }
      });

      console.log(`✅ 배치 ${batchIndex + 1} 완료 (${processedCount}/${snapshot.size})`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ 구독 데이터 구조 마이그레이션 완료!");
    console.log(`📊 처리 결과:`);
    console.log(`   - 전체 사용자: ${snapshot.size}개`);
    console.log(`   - 마이그레이션 완료: ${migratedCount}개`);
    console.log(`   - 스킵됨 (이미 v2): ${skippedCount}개`);
    console.log(`   - 오류 발생: ${errorCount}개`);
    console.log("⏰ 완료 시간:", new Date().toISOString());
    console.log("=".repeat(60));

  } catch (error) {
    console.error("💥 마이그레이션 스크립트 실행 중 오류 발생:", error);
    console.error("스택 트레이스:", error.stack);
  }
}

/**
 * 🔄 단일 사용자 데이터 마이그레이션
 * @param {admin.firestore.DocumentSnapshot} doc - 사용자 문서
 * @return {Promise<{migrated: boolean, reason: string}>}
 */
async function migrateSingleUser(doc) {
  try {
    const userId = doc.id;
    const userData = doc.data();

    // 이미 v2 구조인지 확인
    if (userData.subscriptionData?.dataVersion === "v2") {
      console.log(`ℹ️ ${userId}: 이미 v2 구조`);
      return { migrated: false, reason: "already_v2" };
    }

    // 마이그레이션 대상 데이터 수집
    const legacyData = {
      lastTransactionInfo: userData.lastTransactionInfo,
      lastWebhookNotification: userData.lastWebhookNotification,
      subscriptionData: userData.subscriptionData,
    };

    // 통합 구독 데이터 생성
    const unifiedSubscriptionData = createUnifiedSubscriptionData(legacyData);

    if (!unifiedSubscriptionData) {
      console.log(`⚠️ ${userId}: 마이그레이션할 데이터 없음`);
      return { migrated: false, reason: "no_data" };
    }

    // 레거시 필드 삭제 목록
    const fieldsToDelete = [
      "lastTransactionInfo",
      "lastWebhookNotification",
      // 기존 fix_transaction.js에서 정의한 레거시 필드들
      "displayName",
      "entitlement",
      "hasLoginHistory",
      "lastUpdated",
      "lastWebhookAt",
      "photoURL",
      "planStatus",
      "subscriptionStatus",
      "welcomeModalSeenAt",
      // 추가 레거시 필드들
      "lastSyncAt",
      "lastSyncMethod",
    ];

    // 업데이트 페이로드 생성
    const updatePayload = {
      subscriptionData: unifiedSubscriptionData,
    };

    // 레거시 필드 삭제 추가
    fieldsToDelete.forEach(field => {
      if (userData[field] !== undefined) {
        updatePayload[field] = admin.firestore.FieldValue.delete();
      }
    });

    // Firestore 업데이트
    await doc.ref.update(updatePayload);

    console.log(`✅ ${userId}: 마이그레이션 완료`, {
      entitlement: unifiedSubscriptionData.entitlement || 'unknown',
      fieldsDeleted: Object.keys(updatePayload).filter(key => key !== 'subscriptionData').length,
    });

    return { migrated: true, reason: "success" };

  } catch (error) {
    console.error(`❌ ${doc.id} 마이그레이션 실패:`, error);
    return { migrated: false, reason: error.message };
  }
}

/**
 * 🔄 레거시 데이터를 통합 구독 데이터로 변환
 * @param {object} legacyData - 레거시 데이터
 * @return {object|null} 통합 구독 데이터
 */
function createUnifiedSubscriptionData(legacyData) {
  try {
    let unifiedData = {};

    // 우선순위: subscriptionData > lastWebhookNotification > lastTransactionInfo
    if (legacyData.subscriptionData) {
      unifiedData = { ...legacyData.subscriptionData };
    } else if (legacyData.lastWebhookNotification) {
      unifiedData = convertWebhookToUnified(legacyData.lastWebhookNotification);
    } else if (legacyData.lastTransactionInfo) {
      unifiedData = convertTransactionToUnified(legacyData.lastTransactionInfo);
    } else {
      return null;
    }

    // 필수 메타데이터 추가/업데이트
    unifiedData.lastUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
    unifiedData.lastUpdateSource = unifiedData.lastUpdateSource || "migration";
    unifiedData.dataVersion = "v2";

    // undefined 값 제거
    const cleanData = {};
    Object.keys(unifiedData).forEach(key => {
      if (unifiedData[key] !== undefined && unifiedData[key] !== null) {
        cleanData[key] = unifiedData[key];
      }
    });

    return cleanData;

  } catch (error) {
    console.error("통합 데이터 생성 실패:", error);
    return null;
  }
}

/**
 * 🔄 웹훅 데이터를 통합 구조로 변환
 * @param {object} webhookData - 웹훅 데이터
 * @return {object} 통합 구독 데이터
 */
function convertWebhookToUnified(webhookData) {
  return {
    originalTransactionId: webhookData.originalTransactionId,
    lastTransactionId: webhookData.lastTransactionId,
    productId: webhookData.productId,
    purchaseDate: webhookData.purchaseDate,
    expiresDate: webhookData.expiresDate,
    notificationType: webhookData.notificationType,
    notificationSubtype: webhookData.subtype,
    offerType: webhookData.offerType,
    lastUpdateSource: "webhook",
  };
}

/**
 * 🔄 트랜잭션 데이터를 통합 구조로 변환
 * @param {object} transactionData - 트랜잭션 데이터
 * @return {object} 통합 구독 데이터
 */
function convertTransactionToUnified(transactionData) {
  return {
    originalTransactionId: transactionData.originalTransactionId,
    lastTransactionId: transactionData.lastTransactionId,
    productId: transactionData.productId,
    purchaseDate: transactionData.purchaseDate,
    expiresDate: transactionData.expiresDate,
    offerType: transactionData.offerType,
    appAccountToken: transactionData.appAccountToken,
    lastUpdateSource: "syncPurchaseInfo",
  };
}

/**
 * 🔍 마이그레이션 미리보기 (실제 변경 없이 확인만)
 */
async function previewMigration() {
  try {
    console.log("🔍 마이그레이션 미리보기 시작...");

    const usersRef = db.collection("users");
    const snapshot = await usersRef.get();

    if (snapshot.empty) {
      console.log("🤷‍♀️ 사용자 문서가 없습니다.");
      return;
    }

    console.log(`📊 총 ${snapshot.size}개의 사용자 문서를 검사합니다.`);

    let alreadyV2 = 0;
    let needsMigration = 0;
    let noData = 0;
    const migrationSources = {
      subscriptionData: 0,
      lastWebhookNotification: 0,
      lastTransactionInfo: 0,
    };

    snapshot.forEach(doc => {
      const userData = doc.data();

      if (userData.subscriptionData?.dataVersion === "v2") {
        alreadyV2++;
      } else if (userData.subscriptionData) {
        needsMigration++;
        migrationSources.subscriptionData++;
      } else if (userData.lastWebhookNotification) {
        needsMigration++;
        migrationSources.lastWebhookNotification++;
      } else if (userData.lastTransactionInfo) {
        needsMigration++;
        migrationSources.lastTransactionInfo++;
      } else {
        noData++;
      }
    });

    console.log("\n" + "=".repeat(50));
    console.log("🔍 마이그레이션 미리보기 결과:");
    console.log(`📊 전체 사용자: ${snapshot.size}개`);
    console.log(`✅ 이미 v2 구조: ${alreadyV2}개`);
    console.log(`🔄 마이그레이션 필요: ${needsMigration}개`);
    console.log(`⚠️ 데이터 없음: ${noData}개`);
    console.log("\n📋 마이그레이션 소스 분석:");
    console.log(`   - subscriptionData: ${migrationSources.subscriptionData}개`);
    console.log(`   - lastWebhookNotification: ${migrationSources.lastWebhookNotification}개`);
    console.log(`   - lastTransactionInfo: ${migrationSources.lastTransactionInfo}개`);
    console.log("=".repeat(50));

  } catch (error) {
    console.error("💥 미리보기 중 오류 발생:", error);
  }
}

// 실행 방법 안내
console.log("🔄 Firestore 구독 데이터 마이그레이션 스크립트");
console.log("📋 사용법:");
console.log("   node migration_script.js preview  - 미리보기 (변경 없이 확인만)");
console.log("   node migration_script.js migrate  - 실제 마이그레이션 실행");
console.log("");

// 명령행 인수 확인
const command = process.argv[2];

if (command === "preview") {
  previewMigration()
    .then(() => process.exit(0))
    .catch(error => {
      console.error("미리보기 실패:", error);
      process.exit(1);
    });
} else if (command === "migrate") {
  migrateSubscriptionData()
    .then(() => process.exit(0))
    .catch(error => {
      console.error("마이그레이션 실패:", error);
      process.exit(1);
    });
} else {
  console.log("❌ 올바른 명령어를 입력해주세요:");
  console.log("   node migration_script.js preview");
  console.log("   node migration_script.js migrate");
  process.exit(1);
} 