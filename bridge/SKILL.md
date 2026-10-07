---
name: pagepatch
description: Edge 확장 PagePatch 로 웹페이지의 CSS/JS 를 고칠 때 (광고·요소 숨기기, 레이아웃·글꼴 바꾸기, 사이트 동작 바꾸기). PagePatch MCP 도구(page_*, css_preview, rule_*)가 있을 때 쓴다.
---

# PagePatch 로 웹페이지 고치기

사용자가 Edge 에서 보고 있는 페이지를 PagePatch 규칙(사이트별 CSS/JS)으로 바꾼다.

## 순서
1. `page_info` - 지금 탭 주소와 이미 있는 규칙을 본다. 같은 사이트 규칙이 있으면 `rule_get` 으로 내용을 먼저 읽는다.
2. `page_outline` / `page_query` - 바꿀 요소의 셀렉터를 찾는다. 처음엔 outline 을 얕게(depth 4~6) 보고, 범위를 좁혀 selector 로 다시 본다.
3. `css_preview` - 저장하지 말고 먼저 적용해서 보여 준다. 필요하면 `page_screenshot` 으로 직접 확인한다. 다시 부르면 이전 미리보기를 대체한다.
4. 사용자가 좋다고 하면 `rule_save` - 기존 규칙이 있으면 그 규칙의 CSS 끝에 더해서(전체를 보내야 함) 저장하고, 없으면 새로 만든다. 저장 뒤 `preview_clear`.
5. JS 규칙은 저장 뒤 `page_reload` 하고 `page_console` 로 오류를 확인한다.

## 원칙
- CSS 로 되는 일은 JS 로 하지 않는다. 숨기기는 `display: none !important`.
- 페이지 스타일을 이기려면 `!important` 를 붙인다 (또는 규칙 옵션 `important`).
- 셀렉터: 해시 같은 자동 생성 class(`style_inner__hZkBc`)는 배포 때마다 바뀐다. id·구조·속성(`[role]`, `[aria-label]`, `[data-*]`) 셀렉터를 먼저 쓰고, 꼭 써야 하면 `[class^="style_inner__"]` 처럼 앞부분만 맞춘다.
- 너무 넓게 숨기지 않는다. `page_query` 로 개수를 확인한다 (생각보다 많이 맞으면 좁힌다).
- URL 범위는 필요한 만큼만 (`*://search.naver.com/*`). 사이트 전체면 도메인만 써도 된다 (`naver.com` → 하위 도메인까지). match pattern 으로 안 되면 정규식: `/^https:\/\/(www\.)?youtube\.com\/(watch|shorts)/` (주소 전체에 검사, `!/…/` 는 제외).
- JS: SPA(유튜브 등)는 내용이 나중에 바뀌므로 `MutationObserver` 를 쓰고, 같은 일을 두 번 하지 않게 표시(data 속성 등)를 남긴다. 페이지 함수·변수를 써야 하면 `isoJS` 를 끄고(MAIN), 아니면 켠다(격리).
- SPA 사이트에서 특정 주소(예: `/watch`)에만 쓰는 JS 는 옵션 `spaJS` 를 켠다. 새로고침 없이 그 주소로 이동해도 다시 실행되고, 떠날 때 `PagePatch.onLeave(() => { …되돌리기… })` 가 불린다. `PagePatch.spa` 는 SPA 이동으로 다시 실행된 것인지.
- 실행 시점: `onLoadJS`(window load 뒤, 이미지·광고까지 다 뜬 다음. 새 규칙 기본) / 문서 준비 후(onLoadJS·atStartJS 둘 다 끔) / `atStartJS`(문서 시작, 깜빡임 방지). 새 규칙은 `important` 도 켜진 채로 만들어진다.
- `page_info` 의 `jsRun` 으로 규칙 JS 가 이 페이지에서 실행됐는지(ran / waiting / error / not-run) 확인한다. `spaNavigated` 이고 not-run 이면 SPA 이동 때문이다.
- 규칙 JS 안에서 `PagePatch.log(...)` 로 남긴 기록은 `page_console` 로 볼 수 있다.
- 잘못 저장했으면 `rule_history` → `rule_revert`.

## AI 규칙 (notes)
- 규칙의 `notes` 는 사용자가 마크다운으로 쓴 "이 사이트를 이렇게 바꾸고 싶다"는 의도다. `rule_get` 으로 읽고, 고칠 때 이 의도를 기준으로 삼는다.
- 사이트 UI 가 바뀌어 규칙이 안 먹으면(요소가 다시 보임, 셀렉터가 0개 맞음) notes 의 항목을 하나씩 지금 화면에서 찾아 셀렉터를 새로 만들고, CSS·JS 를 고쳐 저장한다. 무엇을 다시 맞췄고 무엇을 못 찾았는지 짧게 말한다.
- notes 가 비어 있는 규칙을 새로 만들거나 크게 고쳤으면 notes 초안도 같이 저장한다 (목적 / 바꿀 것 / 확인 방법). 셀렉터가 아니라 눈에 보이는 모양으로 쓴다 ("오른쪽 광고 칸", "로고 아래 큰 배너").
- 사용자가 쓴 notes 는 사용자가 원할 때만 고친다.

## 말하기
- 한국어로 짧게. 무엇을 바꿨는지 한두 줄로 말하고, 저장할지 묻는다.
- 셀렉터나 코드 전문을 길게 늘어놓지 않는다 (물어보면 보여 준다).
