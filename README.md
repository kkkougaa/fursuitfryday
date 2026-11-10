# #FursuitFryday (iOS)

행사 사진에 **사진사·퍼슈트**를 붙이고, 어느 컷을 **SNS에 올렸는지** 기록하는 아이폰 앱.
웹 버전(`fursuitfryday`)을 네이티브로 옮긴 것이다.

- **사진은 사진첩에서 읽기만 한다.** 행사 사진을 전부 모아 둔 **앨범 하나**를 고르면 그 안의 사진을 계속 따라간다.
  어느 행사 사진인지는 앱이 사진마다 기록한다 — 찍은 날짜·장소·카메라를 보고 제안하고, 사람이 확정한다.
- **태그·사용 이력·일정은 앱의 기록 파일(`catalog.json`)에만** 있다. 사진 파일에는 아무것도 쓰지 않는다.
- 기록 파일은 **드롭박스 앱 폴더**에 백업한다(사진은 올리지 않는다).
- 아이폰 전용, iOS 17 이상.

## 빌드

맥 없이 GitHub Actions 로 만든다. `project.yml`(XcodeGen) → `.github/workflows/build.yml`.

- `main` 이 아닌 브랜치에 푸시: 무서명 컴파일 확인
- `main` 에 푸시: 서명해서 TestFlight 업로드 (Secrets 가 없으면 무서명 ipa 만 남긴다)

필요한 Secrets 는 워크플로 파일 머리말에 적혀 있다. 번들 ID 는 `com.kouga.fursuitfryday`.

## 드롭박스 연결

1. 드롭박스 앱 콘솔에서 **App folder** 방식으로 앱을 만든다. 권한은 `files.content.read`, `files.content.write`.
2. 앱 설정의 OAuth 2 에서 **Allow public clients (Implicit Grant & PKCE)** 를 켠다.
3. App key 를 `project.yml` 의 `DropboxAppKey` 에 넣는다(공개 클라이언트라 비밀 값이 아니다).
4. 앱에서 "연결"을 누르면 승인 화면이 열린다. 거기 뜨는 코드를 앱에 붙여넣는다.
   (드롭박스가 리다이렉트 주소를 https 만 받아서 코드 붙여넣기 방식을 쓴다)

## 구조

```
App/FursuitFrydayApp.swift   앱 진입, 탭, 화면 이동 값
App/Theme.swift              색·버튼·세그먼트·사진 칸
App/Model/Catalog.swift      기록 스키마, 합치기, 저장소
App/Model/Events.swift       행사(일정)·약속·체크리스트, 날짜 계산
App/Model/PhotoLibrary.swift 고른 앨범의 사진 읽기, 기록 키(클라우드 ID)
App/Model/Dropbox.swift      PKCE 로그인, catalog.json 받기·올리기
App/Model/Meta.swift         테마 색 계산, 촬영 정보(EXIF), 프로필 사진, 장소 이름
App/Model/SuitMatcher.swift  퍼슈트 추천 (피사체 분리 + 이미지 특징값)
App/Views/                   모아보기 · 사진 · 사진 상세 · 일정 · 프로필 · 설정
```

## 웹 버전과 다른 점

- 구글 드라이브·폴더 동기화가 없다. 그래서 폴더 이름 기반 제안은 없고, 날짜 → 행사, 카메라 → 사진사,
  "이날 사진이 몰려 있어요 → 새 행사" 제안은 그대로다. 새 행사 제안은 같은 날이라도 찍은 장소가 멀면 따로 묶는다.
- 사진의 키는 드라이브 fileId 가 아니라 사진첩의 클라우드 ID 다.
- 일본어 화면, 일일 백업 사본, 썸네일 캐시 설정은 옮기지 않았다.
- 퍼슈트 추천이 새로 들어갔다. 추천 기준은 고정 숫자가 아니라, 사용자가 태그해 둔 사진에서 퍼슈트별로 스스로 잡는다
  (`SuitMatcher` 머리말). 본보기가 모자란 동안에는 칩을 띄우지 않고 고르는 목록의 순서만 닮은 순으로 바꾼다.
