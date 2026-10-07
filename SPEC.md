# PagePatch - 기획서

Edge 확장 **User JavaScript and CSS** (ID `nbhcbdghjpllgmfilhnhkllmkecfmpld`, v3.1.2) 를 **필요한 기능만 남겨** 다시 만든다.
더한 것: **Claude Code 연결**(사이드바 채팅 + 터미널), **동기화 두 가지**(브라우저 계정 + WebDAV), **SPA 대응**, **URL 정규식**, **실행 상태 표시**, **변경 기록**.
외부 라이브러리 주입(jQuery 등) 없음. 분석/광고/외부 전송 없음.
외부 통신은 사용자가 연결한 WebDAV 서버, 그리고 이 PC 안의 연결 프로그램(네이티브 메시징)뿐이다.

## 1. 규칙
규칙 = 이름 + URL 패턴 + JS + CSS + 옵션. 저장소는 `chrome.storage.local` (unlimitedStorage).

### URL 패턴
- 쉼표로 여러 개. `!` 로 시작하면 제외
- **변환 모드(기본)**: 원본 변환 로직을 그대로 옮김. `naver.com` → `*://*.naver.com/*`, `https://a.b.com/` → `https://a.b.com/*`
- **URL 그대로(strictUrl)**: match pattern 그대로
- **정규식**: `/…/플래그`. 주소 전체(location.href)에 검사. 안의 쉼표는 구분자가 아님. `!/…/` 는 제외
  - 정규식이 있는 규칙은 `*://*/*` 로 넓게 등록하고, 페이지에서 주소를 다시 검사한 뒤 실행
- 편집기 아래에 변환 결과(적용/제외/잘못된 패턴)를 바로 보여 줌

### 옵션
| 옵션 | 뜻 |
|---|---|
| 켜기/끄기 (`off`) | |
| JS 만 끄기 (`offJS`) · CSS 만 끄기 (`offCSS`) | 편집기의 JS · CSS 제목 옆 체크박스. 코드는 그대로 두고 그쪽만 넣지 않음 (체크 = 켜짐) |
| URL 그대로 (`strictUrl`) | |
| JS 격리 실행 (`isoJS`) | `USER_SCRIPT` world. 끄면 `MAIN` (페이지 변수·함수 사용) |
| JS 모든 프레임 (`deepJS`) | iframe 에도 (프레임마다 주소 검사) |
| JS 실행 시점 | 문서 준비 후(`document_end`) / 일찍(`atStartJS`, `document_start`) / **페이지 로드 후(`onLoadJS`, window load, 새 규칙 기본)** |
| **SPA 이동 시 다시 실행 (`spaJS`)** | 주소만 바뀌는 이동(pushState 등) 뒤 새 주소가 맞으면 JS 를 다시 실행. 떠날 때 `PagePatch.onLeave(fn)` |
| CSS 강제 적용 (`isoCSS`) | `scripting.insertCSS`(origin USER). 끄면 `<style>` 태그 |
| CSS 모든 프레임 (`deepCSS`) | |
| 자동 !important (`important`, 새 규칙 기본 켜짐) | 넣을 때만 선언마다 붙임 (작성한 CSS 는 그대로). @keyframes·@font-face·변수(--x) 제외 |

### 넣는 방식
- JS: `chrome.userScripts` 에 규칙마다 1개. 사용자가 "사용자 스크립트 허용"을 켜야 함
  - 페이지 환경(MAIN) + 기본/일찍: **원본처럼 코드를 그대로** 실행 (const·async function 도 전역 → 콘솔에서 부를 수 있음). 앞뒤 작은 스크립트로 실행 여부·오류만 기록
  - 격리 환경, onload, SPA 다시 실행, 정규식 규칙: 블록(또는 함수)으로 감싸 try/catch
- CSS: userScripts 로 `<style data-pagepatch>` (기본) 또는 탭마다 insertCSS. 사용자 스크립트가 꺼져 있으면 모두 insertCSS
- 규칙을 고치면 열린 탭의 CSS 를 바로 바꿈. JS 는 새로고침해야 실행
- SPA 이동: content.js 가 `navigation` 의 navigate 이벤트 → 0.5초 뒤 주소가 바뀌었으면 background 에 알림 → CSS 다시 맞춤, 떠난 규칙엔 `pagepatch:leave`, spaJS 규칙은 `userScripts.execute`

### 규칙 안에서 쓰는 `PagePatch`
- `PagePatch.log/warn/error(...)` → Claude 의 `page_console`
- `PagePatch.url`, `PagePatch.spa`(SPA 이동으로 다시 실행된 것인지)
- `PagePatch.onLeave(fn)` → SPA 로 안 맞는 주소로 떠날 때

### 실행 상태
탭마다 규칙 JS 가 **실행됨 / 대기(onload) / 오류 / 실행 안 됨** 인지 기록해서 팝업에 표시.
SPA 이동이 있었는데 spaJS 가 아니라 실행 안 된 경우는 따로 알려 줌 ("SPA 이동 - 새로고침하거나 'SPA 이동 시 다시 실행' 켜기").

### 복사 제한 해제
- 사이트(호스트)마다 `copy`(우클릭·선택·드래그·복사 차단 해제) / `strong`(키·마우스 이벤트 차단까지 무력화). 둘 다 끄면 목록에서 빠짐
- 저장: `settings.sites` (`{ "example.com": { copy, strong } }`, 주소순) → 설정과 같이 동기화 (합치기는 설정 전체 단위로 늦은 쪽)
- 넣기: `tabs.onUpdated` complete 때 `inject/unlock-copy.js` · `inject/unlock-strong.js` 를 MAIN world·모든 프레임에 `executeScript`. 켤 때는 바로 넣고, 끄는 것은 새로고침 후

### 검색 이동 (StayTab 의 주소창 키워드)
- 저장: `state.jumps = { 키워드: { id, url, updated } | { id, deleted, updated } }` (storage.local `jumps`). 키워드 = 띄어쓰기를 지운 소문자 (`jumpKey`). 규칙처럼 항목마다 합치기, 삭제 표시 30일. 브라우저 동기화 항목 `jump:<키워드>`, WebDAV 파일·내보내기에도
- 이동: 키워드 × 검색엔진(Google · Bing · 네이버 · 다음 · DuckDuckGo)마다 declarativeNetRequest redirect. 글자 사이에 `+*` 를 끼운 정규식으로 띄어쓰기 무시, 한/영 변형(`src/hangul.js`)
- 브라우저 정규식(RE2) 메모리 한도가 작다 (2026-10 Edge 측정: 한글 7자 · 영문 27자). `isRegexSupported` 로 확인해 ① 변형 묶음 정규식 ② 변형마다 정규식 ③ urlFilter(띄어쓰기 없는 모양, 크기 한도 없음) 순서로
- 대비책: `tabs.onUpdated` 에서 탭 주소가 키워드 검색이면 한 번 더 옮김 (검색 미리 로드로 규칙을 건너뛴 경우, ③ 키워드를 띄어 쓴 경우)

### 탭 복원 · 새 탭 주소 (StayTab)
- `settings.restore`, `settings.newtab = { on, url }` (설정과 같이 동기화). 상주는 선택 권한 `background` (동기화 안 함)
- 탭 목록 `storage.local.staySession`, 창 0개 `storage.session.stayIdle` (`src/stay.js`). 새 탭 `chrome_url_overrides.newtab` → `newtab.js` 가 저장소를 직접 읽고 `tabs.update`

## 2. 화면
- **팝업**: 맨 위 복사 제한 해제 / 강력 해제 (http·https 페이지), 그 아래 이 페이지에 맞는 규칙(켜기/끄기, JS 실행 상태, 등록 오류), 이 사이트 규칙 만들기, **AI와 고치기**(사이드바 열기), 설정
- **설정 - 사이트 규칙**: 목록(검색, 이름순), 편집기(Ace, CSS/JS 탭, Ctrl+S, 찾기, 자동완성), 옵션, 변경 기록(최근 20개, 불러와서 저장), 삭제. 다른 곳(Claude·동기화)에서 바뀌면 알림
- **AI 규칙**(규칙의 `notes`, 마크다운): 편집기의 "AI 규칙" 버튼으로 아래 영역을 JS · CSS ↔ AI 규칙(왼쪽 편집, 오른쪽 미리보기 `src/markdown.js`)으로 전환. 화면을 어떻게 바꾸려는지 사람이 적어 두면, 사이트 UI 가 바뀌어 CSS·JS 가 깨졌을 때 AI 가 `rule_get` 으로 읽고 그 의도대로 다시 맞춘다 (`rule_save` 의 `notes`, SKILL.md). 저장·기록·동기화는 규칙과 같이
- **설정 - 검색 이동** (사이트 규칙 탭 오른쪽): 주소 + 키워드(쉼표), 주소별로 묶은 목록(한/영 변형은 회색), 행 눌러 고치기, 삭제
- **설정 - 설정**: 카드 3장 — ① 표시 · AI Code(Claude Code 연결) ② 브라우저(백그라운드 상주 · 탭 복원 · 새 탭 주소) ③ 동기화 · 데이터
- **설정 - 복사 제한 해제**: 사이트 추가(주소 → 호스트)·검색·모드 체크·삭제
- **설정 - 설정**: 사용자 스크립트 상태·켜는 방법, Claude Code 연결, 동기화, 배지, 가져오기/내보내기
- **사이드바**: Claude Code 채팅 (아래)
- 배지(기본 켜짐): 이 페이지에 적용된 활성 규칙 수 (초록 바탕, 검은 글자)
- 팝업: 규칙이 없으면 "사이트 규칙 추가"만, 규칙이 있고 Claude Code 가 연결돼 있을 때만 "AI와 고치기"
- 규칙 활성화는 설정의 규칙 목록 왼쪽 체크박스와 팝업에서. 편집기는 JS(왼쪽)·CSS(오른쪽)를 나란히, 옵션은 각 편집기 위에
- 아이콘: TapCode·StayTab·EdgeMark 와 같은 모양 (#2563EB 둥근 사각형, 흰 반창고, 노란 패드) - `tools/make-icons.mjs`

## 3. Claude Code 연결
```
사이드바 ─port─ background ─네이티브 메시징─ bridge/host.mjs ─┬─ claude -p (사이드바 채팅, PagePatch 도구만)
                     ▲                                          │      └ mcp.mjs ─┐
                     └──────────── 도구 요청 ───────────────────┤                 │ 127.0.0.1 WebSocket (토큰)
                                                                └─ 터미널 claude ─ mcp.mjs ┘
```
- `bridge/install.ps1` 로 한 번 등록: `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.pagepatch.bridge` (PagePatch 확장 ID 만 허용). `-WithMcp` 면 터미널 claude 에도 MCP 등록
- bridge 파일은 확장 패키지 안에 같이 들어 있다 (바깥 주소에서 받지 않음). 스토어 설치는 설정·사이드바가 보여 주는 등록 명령(`src/bridgesetup.js`, `powershell -EncodedCommand …` → PowerShell · cmd 둘 다 됨)으로: Edge 의 `User Data\<프로필>\Extensions\<확장 ID>\<버전>\bridge\install.ps1` 을 찾아 실행 → install.ps1 이 `%LOCALAPPDATA%\PagePatch\bridge` 로 복사해서 등록 (확장 업데이트로 버전 폴더가 바뀌어도 동작)
- `bridge/version.mjs` 의 BRIDGE_VERSION: 호스트가 hello 로 알리고, 확장에 든 것과 다르면 `bridgeStatus.outdated` → 설정·사이드바가 같은 명령으로 다시 등록하라고 안내. bridge 파일을 바꾸면 올린다
- 확장 ID: 개발자 모드는 manifest 의 `key` 로 고정 `ljpifelibjbpdkjmjpalhegmmpopaakn`, 스토어는 `ebpahfbghidgbkmbjhgijokfjmoeccan` (스토어 zip 은 `key` 를 뺌). install.ps1 의 allowed_origins 에 둘 다
- 호스트는 Edge 가 띄우고 Edge 가 끊으면 끝남. 127.0.0.1 에서 MCP 클라이언트를 받을 때 `bridge.json` 의 토큰 확인, Origin 있는 요청(웹페이지) 거절
- **사이드바 채팅**: `claude -p --output-format stream-json --include-partial-messages --tools "" --strict-mcp-config --mcp-config <pagepatch> --allowedTools mcp__pagepatch --permission-mode dontAsk --append-system-prompt <SKILL.md>`
  - 파일·명령 도구 없음, PagePatch 도구만. 대화는 `--resume` 으로 이어감. 창마다 대화 보관(session)
  - 답을 실시간으로 보여 주고, 도구 호출을 줄로 표시. 중지, 새 대화, 미리보기 지우기
- **도구**: page_info, page_outline, page_query, page_screenshot, css_preview, js_preview, preview_clear, page_reload, page_console, page_eval(설정에서 허용할 때만), rules_list, rule_get, rule_save, rule_history, rule_revert
- 작업 지침: `bridge/SKILL.md` (사이드바 시스템 프롬프트, 터미널 스킬로도 사용)

## 4. 동기화
EdgeMark · StayTab 과 같이 **브라우저 계정 / 서버(WebDAV) 중 하나**. 둘 다 이 PC 의 규칙과 **합치는** 방식 (규칙마다 updated 가 늦은 쪽, 삭제는 30일간 표시).
- **브라우저 계정** (기본): `storage.sync`. 규칙 하나 = 항목 하나 (`rule:<id>`), 8 KB 넘으면 조각. 사용량 표시, 80 KB 넘으면 경고
- **서버(WebDAV)**: "서버(WebDAV) 동기화 연결"로 전환. EdgeMark 와 같은 모듈 (PBKDF2 → AES-GCM 암호화, ETag 충돌 감지). 변경 5초 뒤 올리기, 15분마다 받아 오기. 서버 모드에서는 storage.sync 를 건드리지 않음
  - 연결할 때 서버와 이 기기에 서로 다른 규칙이 있으면 묻는다: 합치기 / 서버 규칙으로 덮어쓰기 / 이 기기 규칙을 서버에 올리기
  - "브라우저 동기화로 전환": 서버 연결 정보를 지우고 지금 규칙을 브라우저 동기화와 합침 (서버 파일은 그대로)
- 동기화 안 하는 것: 변경 기록, WebDAV 접속 정보, Claude 연결 설정

## 5. 기존 규칙 옮기기
기존 규칙은 사용자가 직접 옮긴다. 확장 소스에는 개인 규칙을 넣지 않는다.
- 설정 → 데이터 → 가져오기: PagePatch 내보내기 파일, 또는 원본 확장 데이터
- 원본 데이터 뽑기: `node tools/export-from-original.mjs` (원본의 LevelDB 로그 → Downloads\pagepatch-original-rules.json)
- 원본 변환: scss → CSS (`//` 주석만 `/* */` 로), `isoStyle` → `isoCSS`, `shared`·`dontSync` 버림, 라이브러리(jQuery)를 쓰던 규칙은 경고 (JS 를 순수 JS 로 고쳐야 함)

## 6. 원본에서 뺀 것
SCSS/LESS 컴파일, Prettier, 외부 라이브러리 주입(jQuery 포함), 공유 규칙(모듈), 규칙별 동기화 제외, 에디터 테마·글꼴 설정, 정렬 4종, 전체 초기화, 예전 형식 경고, 다국어(한국어만), 후원·What's new 화면

## 7. 파일
```
manifest.json  background.js  content.js
popup.*  options.*  sidepanel.*  ui.css
src/  model urls css inject store merge sync syncitems import tools bridge unlock jump stay hangul (+ webdav crypto key ← EdgeMark)
newtab.html newtab.js   (← StayTab)
inject/  unlock-copy.js unlock-strong.js
bridge/  host.mjs mcp.mjs ws.mjs common.mjs version.mjs tooldefs.mjs SKILL.md install.ps1  (스토어 zip 에도 들어감)
vendor/ace/  (Ace 1.44, CSS·JS 모드, 테마 2개, 검색, 자동완성)
tools/  export-from-original.mjs make-icons.mjs
test/run.mjs
```
