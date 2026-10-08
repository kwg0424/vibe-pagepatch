# PagePatch

사이트마다 내 CSS·JS 를 적용하는 Edge 확장. 오른쪽 사이드바에서 **Claude Code 와 대화하며 지금 보고 있는 페이지를 바로 고칠** 수 있습니다.
복사 제한 해제, 검색 이동 · 탭 복원 · 새 탭 주소(StayTab)도 여기에 합쳤습니다.

## 설치 (개발자 모드)
1. `edge://extensions` → 왼쪽 아래 **개발자 모드** 켜기 → **압축을 푼 확장 로드** → 이 폴더
2. PagePatch **세부 정보** → **사용자 스크립트 허용** 켜기 (JS 규칙에 필요)

## Claude Code 연결 (선택)
Node.js 22 이상과 Claude Code(`claude`)가 필요합니다. PC 마다 한 번 연결 프로그램을 등록합니다.

**스토어에서 받았으면**: PagePatch 설정 → **AI Code** 에 나오는 등록 명령을 복사해서 PowerShell 이나 명령 프롬프트(cmd)에 붙여 넣습니다.
연결 프로그램 파일(`bridge/`)은 확장 안에 같이 들어 있어서 인터넷에서 받지 않습니다. 명령은 Edge 가 이 확장을 풀어 둔 폴더에서 `bridge\install.ps1` 을 찾아 실행하고,
install.ps1 이 파일을 `%LOCALAPPDATA%\PagePatch\bridge` 로 복사해서 등록합니다. 확장이 업데이트되어 연결 프로그램이 바뀌면 설정·사이드바에 "예전 버전" 안내가 나오니 같은 명령을 다시 실행하세요.
터미널 `claude` 에서도 PagePatch 도구를 쓰려면 "터미널 claude 에도 등록" 명령을 쓰세요.

**이 폴더를 개발자 모드로 로드했으면**:
```powershell
powershell -ExecutionPolicy Bypass -File bridge\install.ps1            # 사이드바 채팅
powershell -ExecutionPolicy Bypass -File bridge\install.ps1 -WithMcp   # + 터미널 claude 에서도 PagePatch 도구
powershell -ExecutionPolicy Bypass -File bridge\install.ps1 -Uninstall # 등록 해제 (스토어 설치본은 %LOCALAPPDATA%\PagePatch\bridge\install.ps1 -Uninstall)
```
그다음 PagePatch 설정 → Claude Code → **연결 사용** 켜기. 팝업의 **AI와 고치기**를 누르면 사이드바가 열립니다.

- "광고 숨겨줘", "본문 폭 넓혀줘" → Claude 가 페이지를 살펴보고 CSS 를 **미리 적용**해서 보여 줍니다
- "저장" → 규칙으로 저장. 잘못 저장했으면 설정 → 사이트 규칙 → **기록**에서 되돌리기
- 사이드바의 Claude 는 PagePatch 도구만 씁니다 (파일 읽기·쓰기, 명령 실행 없음)

## 규칙
- **주소**: 규칙마다 `기본` / `정규식` 중 선택. 기본은 `a.com`(그 주소 루트만), `a.com/**`(모든 경로), `*.a.com`(하위 도메인), `!` 로 제외. 정규식은 `/…/플래그` (주소 전체에 검사)
- **JS · CSS 따로 켜고 끄기**: 편집기의 JS · CSS 제목 옆 체크박스 (코드는 그대로 두고 그쪽만 적용 안 함)
- **JS 실행 시점**: 페이지 로드 후(onload, 새 규칙 기본) / 문서 준비 후 / 일찍. 새 규칙은 CSS **자동 !important** 도 켜진 채로 시작
- **SPA 이동 시 다시 실행**: 유튜브처럼 새로고침 없이 주소만 바뀌어도 다시 실행. 떠날 때 `PagePatch.onLeave(() => …)`
- 팝업에서 규칙 JS 가 이 페이지에서 **실행됨 / 대기 / 오류 / 실행 안 됨**인지 볼 수 있습니다
- 규칙 JS 안에서 `PagePatch.log(...)` 로 남긴 기록은 Claude 가 봅니다

## 복사 제한 해제
- 팝업 맨 위 **복사 제한 해제 / 강력 해제**: 이 사이트의 우클릭·드래그 선택·복사 차단을 풉니다. 켜면 바로, 끄면 새로고침 후 반영
- 설정 → **복사 제한 해제** 탭: 사이트 추가·검색·삭제. 목록은 설정과 같이 동기화

## 검색 이동 (StayTab 의 주소창 키워드)
- 설정 → **검색 이동** 탭: 주소 + 키워드(쉼표로 여러 개). 주소창에 키워드만 치고 Enter → 검색하지 않고 그 주소로
- **띄어쓰기 상관없음**: 키워드는 띄어쓰기를 빼고 저장하고(`구글 지도` → `구글지도`), `구글 지도` · `구글지도` · `구글  지도` 모두 이동
- 한/영 전환 없이 쳐도 됨 (`지도` = `wleh` = `WLEH`). 기본 검색엔진이 Google · Bing · 네이버 · 다음 · DuckDuckGo 일 때
- 브라우저 규칙(declarativeNetRequest)이 검색 요청을 바로 바꾼다. 긴 키워드(한글 8자 · 영문 28자 이상)는 브라우저 정규식 한도 때문에 띄어쓰기 없는 모양만 바로 가고, 띄어 쓰면 검색 결과가 잠깐 보였다 넘어간다

## 브라우저 (StayTab)
- 설정 → 브라우저: **백그라운드 상주**(선택 권한 `background`, 이 PC 에만) · **탭 복원**(상주 중 창을 다시 열면 닫기 전 탭) · **새 탭 주소**(새 탭 페이지를 덮어써 바로 이동)
- 설치 후 Edge 가 "새 탭 페이지 변경을 유지할지" 한 번 묻는다 → 유지. 새 탭 주소를 끄면 빈 안내 페이지가 뜬다

## 동기화 (둘 중 하나)
- **브라우저 계정**(기본): Edge 확장 동기화를 켠 PC 끼리
- **서버(WebDAV)**: 설정 → 동기화 → "서버(WebDAV) 동기화 연결". 아이디·비밀번호로 암호화해서 내 서버에

## 기존 확장(User JavaScript and CSS)에서 옮기기
```
node tools/export-from-original.mjs
```
→ `Downloads\pagepatch-original-rules.json` 을 설정 → 데이터 → **가져오기**. jQuery 같은 라이브러리를 쓰던 규칙은 경고가 나오니 순수 JS 로 고쳐 주세요.

## 개발
```
node test/run.mjs           # 테스트 (URL·CSS·가져오기·동기화·브리지)
node tools/make-icons.mjs   # 아이콘 다시 만들기
```
