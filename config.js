// config.example.js — 이 파일을 config.js 로 복사한 뒤 값을 채우세요.
// config.js 는 .gitignore 에 들어 있습니다.

export const CONFIG = {
  // Google Cloud Console → API 및 서비스 → 사용자 인증 정보
  // "OAuth 2.0 클라이언트 ID" (웹 애플리케이션) 의 클라이언트 ID
  CLIENT_ID: '000000000000-xxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com',

  // 같은 화면의 "API 키". Google Picker 에 필요합니다.
  API_KEY: 'AIzaSy...',

  // 로그인 후 돌아올 주소. Cloud Console 의 "승인된 리디렉션 URI" 에
  // 아래 값과 **문자 하나까지 똑같이** 등록되어 있어야 합니다.
  // 개발:  http://localhost:5173/
  // 배포:  https://<사용자명>.github.io/cutdaejang/
  REDIRECT_URI: location.origin + location.pathname,

  // 앱이 만든 파일에만 접근합니다. 구글 검증이 필요 없는 스코프입니다.
  SCOPE: 'https://www.googleapis.com/auth/drive.file',
};
