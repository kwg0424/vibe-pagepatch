// 검색 이동 (StayTab 의 '주소창 키워드' 를 옮김) → declarativeNetRequest 리다이렉트 규칙.
// 주소창에 "구글 지도" 를 치고 Enter 하면 Edge 가 기본 검색엔진으로 검색한다. 그 검색 요청이 나가기 전에
// 브라우저가 등록된 주소로 바꿔 보낸다 → 서비스 워커를 거치지 않아 바로 가고, 검색 결과 페이지는 뜨지 않는다.
//   - 띄어쓰기는 상관없다: 키워드는 띄어쓰기를 지워 저장하고("구글지도"), 검색어는 글자 사이에 공백이 몇 개 있어도 맞춘다
//   - 한/영 전환 없이 친 것(wleh, WLEH)도 맞춘다. 대소문자는 가리지 않는다
// 저장 모양 (state.jumps, src/model.js): { "<키워드>": { id: 키워드, url, updated } | { id, deleted, updated } }
//
// 브라우저 정규식(RE2)은 메모리 한도가 작아서 긴 키워드는 받지 않는다 (2026-10 Edge 에서 잰 값: 띄어쓰기 무시 모양으로
// 한글 7자 · 영문 27자까지). 그래서 키워드 × 검색엔진마다 이렇게 고른다 (background 가 isRegexSupported 로 확인):
//   1. 변형(지도 · wleh)을 한 정규식에  2. 변형마다 정규식 하나씩  3. 그래도 크면 urlFilter(크기 한도 없음)로 띄어쓰기 없는 모양만
// 3번이 된 키워드를 띄어 쓴 경우와 "검색 미리 로드" 로 규칙을 건너뛴 경우는 background 의 대비책(탭 주소를 보고 옮김)이 맡는다.
import { toQwerty, toHangul } from "./hangul.js";

// re: 검색어 매개변수 앞부분까지 (정규식), bases: urlFilter 용 주소 앞부분, param: 검색어 매개변수.
// host 권한(<all_urls>)이 있어야 리다이렉트가 된다
export const ENGINES = [
  { re: "^https://www\\.google\\.(?:com|co\\.kr)/search\\?(?:[^#]*&)?q=", bases: ["https://www.google.com/search?", "https://www.google.co.kr/search?"], param: "q" },
  { re: "^https://www\\.bing\\.com/search\\?(?:[^#]*&)?q=", bases: ["https://www.bing.com/search?"], param: "q" },
  { re: "^https://search\\.naver\\.com/search\\.naver\\?(?:[^#]*&)?query=", bases: ["https://search.naver.com/search.naver?"], param: "query" },
  { re: "^https://search\\.daum\\.net/search\\?(?:[^#]*&)?q=", bases: ["https://search.daum.net/search?"], param: "q" },
  { re: "^https://duckduckgo\\.com/\\?(?:[^#]*&)?q=", bases: ["https://duckduckgo.com/?"], param: "q" },
];

export const JUMP_MAX_LENGTH = 40;

// 저장할 키워드: 띄어쓰기를 모두 지우고 소문자로 ("구글 지도" → "구글지도"). 쓸 수 없으면 null
export function jumpKey(input) {
  const s = String(input || "").replace(/\s+/g, "").toLowerCase();
  return s && s.length <= JUMP_MAX_LENGTH ? s : null;
}

// 키워드를 이렇게 쳐도 맞춘다: 그대로, 영문 자판으로 친 한글, 한글 자판으로 친 영문
export function variants(keyword) {
  const set = new Set([keyword, toQwerty(keyword).toLowerCase()]);
  if (/^[a-z]+$/i.test(keyword)) set.add(toHangul(keyword));
  return [...set].filter(Boolean);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const encodeChars = (v) => [...v].map((ch) => escapeRe(encodeURIComponent(ch)));
// 글자 사이·앞뒤에 공백이 몇 개 와도 된다 (한글은 글자마다 퍼센트 인코딩한 뒤 사이에 끼운다).
// 브라우저 규칙: 주소창 검색의 공백은 + 로만 온다 (%20 까지 넣으면 정규식이 커져 받는 길이가 줄어든다)
const SP_RULE = "\\+*";
// 대비책(JS 정규식, 크기 한도 없음): %20 도
const SP_JS = "(?:\\+|%20)*";
const term = (v, sp) => sp + encodeChars(v).join(sp) + sp;
const regexFor = (engine, vs, sp) => `${engine.re}(?:${vs.map((v) => term(v, sp)).join("|")})(?:&|#|$)`;

// urlFilter: 띄어쓰기 없는 모양 그대로. 검색어 앞은 ? 또는 &, 뒤는 & · # · 주소 끝 (| 는 주소 끝).
// * | ^ 가 든 키워드는 urlFilter 문법과 겹쳐서 만들지 않는다 (대비책이 맡음)
export function urlFilters(engine, v) {
  const enc = encodeURIComponent(v);
  if (/[*|^]/.test(enc)) return [];
  const out = [];
  for (const base of engine.bases)
    for (const before of ["", "*&"]) for (const after of ["&", "#", "|"]) out.push(`|${base}${before}${engine.param}=${enc}${after}`);
  return out;
}

// 규칙 후보: 키워드 × 검색엔진마다 { url, combined: 정규식, each: [{ regex, filters }] } (변형마다)
export function ruleCandidates(jumps) {
  const out = [];
  for (const j of Object.values(jumps)) {
    if (j.deleted) continue;
    const vs = variants(j.id);
    for (const engine of ENGINES) {
      out.push({
        url: j.url,
        combined: regexFor(engine, vs, SP_RULE),
        each: vs.map((v) => ({ regex: regexFor(engine, [v], SP_RULE), filters: urlFilters(engine, v) })),
      });
    }
  }
  return out;
}

const redirect = (url) => ({ type: "redirect", redirect: { url } });
export const regexRule = (id, url, regex) => ({
  id, priority: 1, action: redirect(url),
  condition: { regexFilter: regex, isUrlFilterCaseSensitive: false, resourceTypes: ["main_frame"] },
});
export const filterRule = (id, url, urlFilter) => ({
  id, priority: 1, action: redirect(url),
  condition: { urlFilter, isUrlFilterCaseSensitive: false, resourceTypes: ["main_frame"] },
});

// 대비책용 (서비스 워커 안 JS 정규식이라 크기 한도가 없다 → 항상 띄어쓰기 무시 모양)
export const matchers = (jumps) =>
  Object.values(jumps)
    .filter((j) => !j.deleted)
    .flatMap((j) => ENGINES.map((engine) => ({ re: new RegExp(regexFor(engine, variants(j.id), SP_JS), "i"), url: j.url })));
