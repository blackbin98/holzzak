# 말랑 홀짝 대결

Firebase Realtime Database로 동작하는 2인용 홀짝 게임입니다. 한 사람이 방을 만들고, 다른 사람이 같은 방 이름과 4자리 비밀번호로 입장하면 실시간 대결이 시작됩니다.

## 주요 기능

- 닉네임, 한글/영문 방 이름, 숫자 4자리 비밀번호로 방 생성
- 기존 방 이름과 비밀번호가 일치할 때만 입장
- 방을 만든 사람이 선공, 입장한 사람이 후공으로 시작
- 숫자 선택 후 상대가 홀/짝을 맞히는 순차 진행
- 라운드마다 공수 교대
- 총 10라운드 진행으로 각 플레이어가 5번씩 문제 출제
- 실시간 점수판과 O/X 기록 반영
- 경기 종료 시 승패 화면, 폭죽 애니메이션, 귀여운 효과음

## 실행

```bash
npm run dev
```

정적 파일만 사용하는 구조라 Vercel에 바로 배포할 수 있습니다. 로컬에서는 Firebase 모듈 로딩 확인을 위해 개발 서버 실행을 권장합니다.

## Firebase 설정

`src/firebase-config.js`에 Firebase 웹 앱 설정이 들어 있습니다. 다른 프로젝트를 사용할 경우 Firebase Console의 웹 앱 설정값으로 교체하세요.

Realtime Database Rules 예시:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

현재 구조는 간단한 친구용 게임에 맞춰 공개 읽기/쓰기를 사용합니다. 공개 서비스로 운영하려면 Firebase Authentication, 서버 검증, 비밀번호 해시 저장, 쓰기 규칙 제한을 추가하는 것을 권장합니다.

## Vercel 배포

GitHub에 이 폴더를 올린 뒤 Vercel에서 새 프로젝트로 Import하면 됩니다. 별도 빌드 명령이나 Output Directory 설정은 필요하지 않습니다.
