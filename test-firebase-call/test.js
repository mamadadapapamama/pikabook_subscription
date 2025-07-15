// test.js
import { initializeApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { connectFunctionsEmulator } from "firebase/functions";

// ✅ 1. Firebase 프로젝트 설정 (웹용 설정 정보 넣기)
const firebaseConfig = {
  apiKey: "AIzaSyARF9UnTtIinsWCmLnG6YX8OZatumrT1UE",
  authDomain: "mylingowith.firebaseapp.com",
  projectId: "mylingowith",
  appId: "1:1113863334:web:29d37d1b5be3e387353067",
};

// ✅ 2. Firebase 초기화
const app = initializeApp(firebaseConfig);

// ✅ 3. Functions 초기화 (로컬 에뮬레이터에 연결)
const functions = getFunctions(app, "asia-southeast1");
connectFunctionsEmulator(functions, "localhost", 5001);

// ✅ 4. 테스트 함수 호출
const extractFn = httpsCallable(functions, "extractOriginalTransactionId");

extractFn({
  transactionId: "dummy-id",
  userId: "test-user"
})
  .then((res) => {
    console.log("✅ Success:", res.data);
  })
  .catch((err) => {
    console.error("❌ Error:", err);
  });
