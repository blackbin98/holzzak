# 홀짝 대결

Firebase Realtime Database를 이용한 2인용 홀짝 게임입니다. 한 명은 0부터 5까지 숫자를 고르고, 다른 한 명은 홀/짝을 맞힙니다. 선택 시간은 30초이며, 승부가 나면 승자 이름과 축하 메시지가 화면에 표시됩니다. Firebase 저장량과 다운로드량을 줄이기 위해 데이터 키를 짧게 저장합니다.

## 실행

```bash
npm run dev
```

정적 파일만 사용하는 구조라서 `index.html`을 브라우저로 열어도 동작합니다. 다만 Firebase 모듈 로딩과 배포 환경 검증을 위해 로컬 서버 실행을 권장합니다.

## Firebase 설정

1. Firebase Console에서 웹 앱을 생성합니다.
2. Realtime Database를 생성합니다.
3. `src/firebase-config.js`의 값을 Firebase 웹 앱 설정값으로 교체합니다.
4. Realtime Database Rules를 아래처럼 설정합니다.

```json
{
  "rules": {
    "r": {
      "$roomId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

공개 배포 전에는 인증 또는 방 코드 기반 검증을 추가해 Rules를 강화하세요. 지금 규칙은 로그인 없는 2인 방 코드 게임이 작동하도록 `r` 경로만 열어둔 설정입니다.

## Vercel 배포

GitHub에 이 폴더를 올린 뒤 Vercel에서 새 프로젝트로 Import하면 됩니다. 별도 빌드 명령은 필요하지 않고, Output Directory도 비워둬도 됩니다.
