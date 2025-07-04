const fs = require('fs');

// 파일 읽기
const content = fs.readFileSync('functions/src/index.js', 'utf8');

// 트랜잭션 부분을 찾아서 수정
const fixedContent = content.replace(
  /await db\.runTransaction\(async \(transaction\) => \{[\s\S]*?const purchaseRef = db\.collection\("purchases"\)\.doc\(transactionId\);\s*transaction\.set\(purchaseRef, purchaseData\);\s*\/\/ 사용자 구독 상태 업데이트\s*const userRef = db\.collection\("users"\)\.doc\(userId\);\s*const userDoc = await transaction\.get\(userRef\);/,
  `await db.runTransaction(async (transaction) => {
      // 🔍 먼저 모든 읽기 작업 수행
      const userRef = db.collection("users").doc(userId);
      const userDoc = await transaction.get(userRef);

      // ✍️ 그 다음에 모든 쓰기 작업 수행
      
      // 구매 기록 저장
      const purchaseRef = db.collection("purchases").doc(transactionId);
      transaction.set(purchaseRef, purchaseData);

      // 사용자 구독 상태 업데이트`
);

// 파일 쓰기
fs.writeFileSync('functions/src/index.js', fixedContent);
console.log('✅ Firebase Functions 트랜잭션 순서 수정 완료!');
