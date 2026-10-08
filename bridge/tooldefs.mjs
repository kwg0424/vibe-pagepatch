// PagePatch MCP 도구 정의. 실제 동작은 확장의 src/tools.js (이름·인자가 같아야 한다).

const tabId = { type: "integer", description: "대상 탭 id. 빼면 Edge 에서 지금 보고 있는 탭 (page_info 로 확인)" };
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });

export const TOOLS = [
  {
    name: "page_info",
    description: "지금 탭의 URL·제목과, 이 페이지에 해당하는 PagePatch 규칙 목록. 작업을 시작할 때 먼저 부른다.",
    inputSchema: obj({ tabId }),
  },
  {
    name: "page_outline",
    description: "페이지 DOM 을 간단한 트리 텍스트로 (태그#id.class [속성] (크기) \"텍스트\"). selector 로 일부만 볼 수 있다. 셀렉터를 찾을 때 쓴다.",
    inputSchema: obj({
      tabId,
      selector: { type: "string", description: "이 요소부터 (빼면 body)" },
      depth: { type: "integer", description: "최대 깊이 (기본 8)" },
      maxNodes: { type: "integer", description: "최대 요소 수 (기본 300)" },
    }),
  },
  {
    name: "page_query",
    description: "CSS 셀렉터에 맞는 요소: 개수, 경로, outerHTML 일부, 텍스트, 위치·크기, 보이는지, computed style.",
    inputSchema: obj(
      {
        tabId,
        selector: { type: "string" },
        limit: { type: "integer", description: "자세히 볼 요소 수 (기본 5)" },
        styles: { type: "array", items: { type: "string" }, description: "볼 CSS 속성 (기본: display, position, width, height, margin, padding, color, background-color, font-size …)" },
      },
      ["selector"]
    ),
  },
  {
    name: "page_screenshot",
    description: "탭의 보이는 화면을 캡처한다 (JPEG). 미리보기 전후를 확인할 때.",
    inputSchema: obj({ tabId }),
  },
  {
    name: "css_preview",
    description: "CSS 를 저장하지 않고 지금 탭에만 임시로 적용한다. 다시 부르면 바뀌고(이전 미리보기 대체), preview_clear 나 새로고침이면 사라진다. 사용자에게 결과를 먼저 보여 줄 때.",
    inputSchema: obj({ tabId, css: { type: "string" }, important: { type: "boolean", description: "선언마다 !important 를 붙여서" } }, ["css"]),
  },
  {
    name: "js_preview",
    description: "JS 를 저장하지 않고 지금 탭에서 한 번 실행한다 (되돌릴 수 없음, 필요하면 page_reload). world: USER_SCRIPT(격리, 기본) | MAIN(페이지 변수 접근).",
    inputSchema: obj({ tabId, js: { type: "string" }, world: { type: "string", enum: ["USER_SCRIPT", "MAIN"] } }, ["js"]),
  },
  {
    name: "preview_clear",
    description: "css_preview 로 넣은 미리보기 CSS 를 지운다.",
    inputSchema: obj({ tabId }),
  },
  {
    name: "page_reload",
    description: "탭을 새로고침한다 (저장한 JS 규칙을 확인할 때).",
    inputSchema: obj({ tabId }),
  },
  {
    name: "page_console",
    description: "이 탭에서 규칙 JS 가 낸 오류와 PagePatch.log() 기록.",
    inputSchema: obj({ tabId, clear: { type: "boolean", description: "읽은 뒤 비우기" } }),
  },
  {
    name: "page_eval",
    description: "페이지에서 JS 를 실행하고 결과(JSON)를 받는다. 사용자가 PagePatch 설정에서 허용했을 때만 동작. 마지막 식의 값이 결과.",
    inputSchema: obj({ tabId, code: { type: "string" }, world: { type: "string", enum: ["MAIN", "USER_SCRIPT"] } }, ["code"]),
  },
  {
    name: "rules_list",
    description: "PagePatch 규칙 목록. url 을 주면 그 주소에 해당하는 규칙만.",
    inputSchema: obj({ url: { type: "string" } }),
  },
  {
    name: "rule_get",
    description: "규칙 하나의 전체 내용 (JS, CSS, notes(AI 규칙: 사용자가 쓴 화면 수정 의도, 마크다운), 옵션, 변환된 URL 패턴, 등록 오류).",
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "rule_save",
    description:
      "규칙을 만들거나(id 없이) 고친다(id 와 바꿀 필드만). 저장하면 바로 적용되고 변경 기록이 남는다. " +
      "urls: 쉼표로 여러 개, !로 시작하면 제외. 입력 방식은 규칙마다 하나: 기본(options.urlBasic, 새 규칙 기본) 또는 정규식(options.urlRegex). " +
      "기본: a.com(그 주소 루트만, http·https 둘 다) · a.com/**(모든 경로) · *.a.com(하위 도메인, a.com 포함) · *(모든 사이트). 스킴은 써도 무시되고 저장 때 지워진다. a.com/a 같은 경로는 못 쓴다(정규식 사용). " +
      "정규식: /정규식/플래그 만 쓴다. 주소 전체(location.href)에 검사(안의 쉼표 괜찮음). " +
      "options: off, urlBasic, urlRegex, isoJS(격리 실행), isoCSS(insertCSS 로 강제), deepJS/deepCSS(모든 프레임), atStartJS(document_start) 또는 onLoadJS(window load 뒤), spaJS(SPA 로 주소가 바뀌면 다시 실행. 떠날 때 규칙의 PagePatch.onLeave(fn) 이 불림), important(자동 !important), offJS · offCSS(이 규칙의 JS · CSS 만 끄기, 코드는 그대로).",
    inputSchema: obj({
      id: { type: "string", description: "고칠 규칙 id. 새로 만들면 빼기" },
      name: { type: "string" },
      urls: { type: "string" },
      js: { type: "string", description: "전체 JS (일부만 바꿀 때도 전체를 보낸다)" },
      css: { type: "string", description: "전체 CSS" },
      notes: { type: "string", description: "AI 규칙(마크다운): 이 규칙이 화면을 어떻게 바꾸는지 의도. 비어 있을 때만 초안을 쓰고, 사용자가 쓴 내용은 사용자가 원할 때만 고친다 (전체를 보낸다)" },
      options: {
        type: "object",
        properties: Object.fromEntries(["off", "urlBasic", "urlRegex", "isoJS", "isoCSS", "deepJS", "deepCSS", "atStartJS", "onLoadJS", "spaJS", "important", "offJS", "offCSS"].map((k) => [k, { type: "boolean" }])),
        additionalProperties: false,
      },
    }),
  },
  {
    name: "rule_history",
    description: "규칙의 이전 버전 목록 (최근 20개, index 0 이 지금).",
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
  },
  {
    name: "rule_revert",
    description: "규칙을 rule_history 의 그 버전으로 되돌린다 (새 버전으로 저장됨).",
    inputSchema: obj({ id: { type: "string" }, index: { type: "integer" } }, ["id", "index"]),
  },
];

export const TAB_TOOLS = new Set(TOOLS.filter((t) => "tabId" in t.inputSchema.properties).map((t) => t.name));

export const INSTRUCTIONS =
  "PagePatch: Edge 에서 사이트마다 사용자 CSS/JS 규칙을 적용하는 확장. 이 도구로 사용자가 보고 있는 페이지를 살펴보고 규칙을 만들고 고친다. " +
  "순서: page_info → page_outline/page_query 로 셀렉터 찾기 → css_preview 로 보여 주기(필요하면 page_screenshot) → 사용자가 좋다고 하면 rule_save → preview_clear. " +
  "같은 사이트 규칙이 있으면 새로 만들지 말고 그 규칙에 더한다(rule_get 으로 지금 내용 먼저). CSS 로 되는 일은 JS 로 하지 않는다. " +
  "규칙의 notes(AI 규칙)는 사용자가 쓴 화면 수정 의도다. 규칙이 안 먹으면(사이트 UI 가 바뀜) notes 의 의도대로 지금 화면에서 셀렉터를 다시 찾아 CSS·JS 를 고친다. " +
  "해시 같은 자동 생성 class(style_x__a1B2c)보다 id·구조·속성 셀렉터를 쓰고, 꼭 써야 하면 [class^=\"style_x__\"] 처럼. 페이지 스타일을 이기려면 !important.";
