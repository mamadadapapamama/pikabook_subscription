// 📁 fix_transaction.js
// 🧹 Firestore 사용자 문서 정리 스크립트 (일회성 실행)

const admin = require("firebase-admin");

// ⚠️ 중요: 실제 서비스 계정 키 파일 경로로 수정해야 합니다
// 예시: const serviceAccount = require("./path/to/your/serviceAccountKey.json");
// 또는 환경 변수를 사용: process.env.GOOGLE_APPLICATION_CREDENTIALS

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
 * 🧹 Firestore 사용자 문서에서 불필요한 필드 제거
 */
async function cleanupUserDocuments() {
  try {
    console.log("🔥 Firestore 사용자 문서 정리 시작...");
    console.log("⏰ 시작 시간:", new Date().toISOString());

    // 삭제할 필드 목록
    const fieldsToDelete = [
      "displayName",
      "entitlement",
      "hasLoginHistory", 
      "lastUpdated",
      "lastWebhookAt",
      "photoURL",
      "planStatus",
      "subscriptionStatus",
      "welcomeModalSeenAt"
    ];

    console.log("🗑️ 삭제 대상 필드:", fieldsToDelete);

    // 사용자 컬렉션 조회
    const usersRef = db.collection("users");
    const snapshot = await usersRef.get();

    if (snapshot.empty) {
      console.log("🤷‍♀️ 정리할 사용자 문서가 없습니다.");
      return;
    }

    console.log(`📊 총 ${snapshot.size}개의 사용자 문서를 검사합니다.`);

    let processedCount = 0;
    let updatedCount = 0;
    let batch = db.batch();
    let batchCounter = 0;
    const BATCH_SIZE = 400; // Firestore 배치 제한 (500개 미만)

    // 각 사용자 문서 처리
    for (const doc of snapshot.docs) {
      const userData = doc.data();
      const updates = {};
      let hasFieldToDelete = false;

      // 삭제할 필드가 있는지 확인
      fieldsToDelete.forEach(field => {
        if (userData[field] !== undefined) {
          updates[field] = admin.firestore.FieldValue.delete();
          hasFieldToDelete = true;
        }
      });

      if (hasFieldToDelete) {
        console.log(`🔧 ${doc.id}: 필드 삭제 준비 - ${Object.keys(updates).join(", ")}`);
        batch.update(doc.ref, updates);
        batchCounter++;
        updatedCount++;

        // 배치 크기 제한 확인
        if (batchCounter >= BATCH_SIZE) {
          console.log(`🚀 ${batchCounter}개 문서 배치 실행 중...`);
          await batch.commit();
          console.log(`✅ 배치 완료 (${updatedCount}/${snapshot.size})`);
          
          // 새 배치 시작
          batch = db.batch();
          batchCounter = 0;
        }
      }

      processedCount++;
      
      // 진행률 표시
      if (processedCount % 100 === 0) {
        console.log(`📈 진행률: ${processedCount}/${snapshot.size} (${Math.round(processedCount/snapshot.size*100)}%)`);
      }
    }

    // 남은 배치 실행
    if (batchCounter > 0) {
      console.log(`🚀 마지막 ${batchCounter}개 문서 배치 실행 중...`);
      await batch.commit();
      console.log(`✅ 최종 배치 완료`);
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ Firestore 사용자 문서 정리 완료!");
    console.log(`📊 처리 결과:`);
    console.log(`   - 검사한 문서: ${processedCount}개`);
    console.log(`   - 업데이트된 문서: ${updatedCount}개`);
    console.log(`   - 변경 없는 문서: ${processedCount - updatedCount}개`);
    console.log("⏰ 완료 시간:", new Date().toISOString());
    console.log("=".repeat(50));

  } catch (error) {
    console.error("💥 스크립트 실행 중 오류 발생:", error);
    console.error("스택 트레이스:", error.stack);
  }
}

/**
 * 🔍 실행 전 미리보기 (실제 삭제 없이 확인만)
 */
async function previewCleanup() {
  try {
    console.log("🔍 정리 대상 미리보기 시작...");

    const fieldsToDelete = [
      "displayName",
      "entitlement", 
      "hasLoginHistory",
      "lastUpdated",
      "lastWebhookAt",
      "photoURL",
      "planStatus",
      "subscriptionStatus",
      "welcomeModalSeenAt"
    ];

    const usersRef = db.collection("users");
    const snapshot = await usersRef.get();

    if (snapshot.empty) {
      console.log("🤷‍♀️ 사용자 문서가 없습니다.");
      return;
    }

    console.log(`📊 총 ${snapshot.size}개의 사용자 문서를 검사합니다.`);

    let documentsWithFields = 0;
    const fieldCounts = {};

    // 필드별 카운트 초기화
    fieldsToDelete.forEach(field => {
      fieldCounts[field] = 0;
    });

    snapshot.forEach(doc => {
      const userData = doc.data();
      let hasAnyField = false;

      fieldsToDelete.forEach(field => {
        if (userData[field] !== undefined) {
          fieldCounts[field]++;
          hasAnyField = true;
        }
      });

      if (hasAnyField) {
        documentsWithFields++;
      }
    });

    console.log("\n" + "=".repeat(50));
    console.log("🔍 미리보기 결과:");
    console.log(`📊 정리 대상 문서: ${documentsWithFields}/${snapshot.size}개`);
    console.log("\n📋 필드별 존재 개수:");
    
    fieldsToDelete.forEach(field => {
      if (fieldCounts[field] > 0) {
        console.log(`   - ${field}: ${fieldCounts[field]}개 문서`);
      }
    });
    
    console.log("=".repeat(50));

  } catch (error) {
    console.error("💥 미리보기 중 오류 발생:", error);
  }
}

// 실행 방법 안내
console.log("🚀 Firestore 사용자 문서 정리 스크립트");
console.log("📋 사용법:");
console.log("   node fix_transaction.js preview  - 미리보기 (삭제 없이 확인만)");
console.log("   node fix_transaction.js cleanup  - 실제 정리 실행");
console.log("");

// 명령행 인수 확인
const command = process.argv[2];

if (command === "preview") {
  previewCleanup()
    .then(() => process.exit(0))
    .catch(error => {
      console.error("미리보기 실패:", error);
      process.exit(1);
    });
} else if (command === "cleanup") {
  cleanupUserDocuments()
    .then(() => process.exit(0))
    .catch(error => {
      console.error("정리 실패:", error);
      process.exit(1);
    });
} else {
  console.log("❌ 올바른 명령어를 입력해주세요:");
  console.log("   node fix_transaction.js preview");
  console.log("   node fix_transaction.js cleanup");
  process.exit(1);
}
