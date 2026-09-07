// config.example.js — 이 파일을 config.js 로 복사한 뒤 값을 채우세요.
// config.js 는 .gitignore 에 들어 있습니다.

export const CONFIG = {
  // Google Cloud Console → API 및 서비스 → 사용자 인증 정보
  // "OAuth 2.0 클라이언트 ID" (웹 애플리케이션) 의 클라이언트 ID
  CLIENT_ID: '194450792516-pgltrltqndm2tu7630bs7j84t3n704us.apps.googleusercontent.com',

  // 같은 화면의 "API 키". Google Picker 에 필요합니다.
  API_KEY: 'AIzaSyDLDkcdzepTBMfuUEbsQg8iKBiNSplrtVE',

  // 로그인 후 돌아올 주소. Cloud Console 의 "승인된 리디렉션 URI" 에
  // 아래 값과 **문자 하나까지 똑같이** 등록되어 있어야 합니다.
  // 개발:  http://localhost:5173/
  // 배포:  https://<사용자명>.github.io/cutdaejang/
  REDIRECT_URI: location.origin + location.pathname,

  // 스코프 두 개를 함께 요청합니다.
  //
  //   drive.readonly  고른 폴더의 하위 사진을 "목록으로 읽기" 위해 필요합니다.
  //                   drive.file 만으로는 피커에서 폴더를 골라도 그 안의
  //                   파일에는 권한이 전파되지 않아 목록이 항상 빈 배열로
  //                   돌아옵니다(에러가 아니라 0건이라 더 헷갈립니다).
  //                   restricted 스코프라 공개 배포하려면 구글 검증이
  //                   필요합니다. 소수만 쓸 거라면 Cloud Console 의
  //                   OAuth 동의 화면을 "테스트" 상태로 두고 쓸 계정을
  //                   테스트 사용자로 추가하세요.
  //
  //   drive.file      catalog.json 을 쓰기 위해 필요합니다. readonly 는
  //                   말 그대로 읽기 전용이라 저장이 안 됩니다.
  //                   이 앱이 만든 파일이므로 drive.file 로 충분합니다.
  //
  // ⚠ 이 값을 바꾸면 Cloud Console 동의 화면의 스코프 목록에도 똑같이
  //   추가해야 합니다. 코드만 바꾸면 invalid_scope 로 튕깁니다.
  SCOPE: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
  ].join(' '),
};
