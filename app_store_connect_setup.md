# App Store Connect 설정 가이드

## 🔗 웹훅 URL 등록

### **1단계: App Store Connect 접속**
1. https://appstoreconnect.apple.com 로그인
2. **Apps** → **pikabook** 선택
3. **App Information** → **App Store Server Notifications** 섹션

### **2단계: 웹훅 URL 설정**
**Production URL:**
```
https://us-central1-mylingowith.cloudfunctions.net/appStoreNotifications
```

**Sandbox URL:**
```
https://us-central1-mylingowith.cloudfunctions.net/appStoreNotifications
```

### **3단계: 알림 타입 선택**
다음 알림들을 활성화하세요:
- ✅ **SUBSCRIBED** (새 구독)
- ✅ **DID_RENEW** (구독 갱신)
- ✅ **DID_CHANGE_RENEWAL_STATUS** (자동 갱신 상태 변경) 👈 **체험 취소 감지**
- ✅ **EXPIRED** (구독 만료)
- ✅ **GRACE_PERIOD_EXPIRED** (유예 기간 만료)
- ✅ **REVOKE** (환불로 인한 취소)

### **4단계: 테스트**
1. 샌드박스 환경에서 테스트 계정으로 구독
2. 구독 취소 후 Firebase Functions 로그 확인
3. Firestore의 `isCancelled: true`, `autoRenewStatus: false` 확인

## 🎯 이제 다음이 가능합니다:

### **즉시 감지 (1-2분 내)**:
1. 유저가 App Store에서 구독 취소
2. Apple → Firebase Functions 웹훅 호출
3. Firestore 자동 업데이트
4. 앱 재시작/포그라운드 복귀 시 배너 표시

### **배너 표시**:
- **제목**: "⏰ 체험 자동 갱신 취소됨"
- **내용**: "체험 기간 종료 시 무료 플랜으로 전환됩니다. 계속 사용하려면 구독하세요"
- **버튼**: "업그레이드"

## 📊 모니터링

Firebase Console에서 함수 로그 확인:
https://console.firebase.google.com/project/mylingowith/functions

로그에서 다음을 확인할 수 있습니다:
- 📡 수신된 알림
- 👤 처리된 사용자
- ✅ Firestore 업데이트 결과
