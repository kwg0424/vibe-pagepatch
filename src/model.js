// 규칙·설정 데이터 모양. 저장·동기화·가져오기가 모두 이 함수로 값을 맞춘다.
//
// Rule = { id, name, urls, js, css, flags, created, updated }
//      | 삭제됨: { id, deleted, updated }   (다른 기기에 삭제를 전하는 표시. 30일 뒤 정리)
// flags:
//   off        규칙 끄기
//   strictUrl  URL 을 변환하지 않고 그대로 쓰기
//   isoJS      JS 를 격리 환경(USER_SCRIPT)에서 실행. 끄면 페이지 환경(MAIN)
//   isoCSS     CSS 를 scripting.insertCSS 로 넣기 (페이지가 못 지움). 끄면 <style> 태그
//   deepJS     JS 를 모든 프레임에
//   deepCSS    CSS 를 모든 프레임에
//   atStartJS  JS 를 document_start 에 실행 (기본 document_end = DOMContentLoaded 무렵)
//   onLoadJS   JS 를 window load(body onload) 뒤에 실행. atStartJS 와 같이 켜지면 atStartJS 를 쓴다
//   spaJS      SPA 이동(주소만 바뀜) 때 새 주소가 맞으면 JS 를 다시 실행
//   important  넣을 때 CSS 선언마다 !important 붙이기
//   offJS      이 규칙의 JS 만 끄기 (코드는 그대로 두고 실행하지 않음)
//   offCSS     이 규칙의 CSS 만 끄기
// Settings = { hideBadge(아이콘에 규칙 수 숨기기, 기본 false = 표시), sites, updated }
//   sites: 우클릭·복사 허용 (DragOn 에서 옮김) { "example.com": { copy, strong } }. 둘 다 끈 사이트는 두지 않는다.
//          설정과 같이 동기화된다 (브라우저 동기화의 settings 항목 8 KB → 사이트 200개쯤까지)

export const FLAGS = ["off", "strictUrl", "isoJS", "isoCSS", "deepJS", "deepCSS", "atStartJS", "onLoadJS", "spaJS", "important", "offJS", "offCSS"];
export const TOMBSTONE_DAYS = 30;
// 새 규칙의 처음 옵션: JS 는 페이지 로드 후(onload), CSS 는 자동 !important. 나머지는 꺼짐 (이미 있는 규칙은 그대로)
export const NEW_RULE_FLAGS = { onLoadJS: true, important: true };

export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `p:${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const str = (v) => (typeof v === "string" ? v : "");
const time = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

export function normalizeFlags(f) {
  const flags = {};
  for (const k of FLAGS) flags[k] = !!f?.[k];
  if (flags.atStartJS) flags.onLoadJS = false; // 실행 시점은 하나
  return flags;
}

export function normalizeRule(r) {
  if (!r || typeof r.id !== "string" || !r.id) return null;
  if (r.deleted) return { id: r.id, deleted: time(r.deleted) || time(r.updated), updated: time(r.updated) || time(r.deleted) };
  return {
    id: r.id,
    name: str(r.name),
    urls: str(r.urls),
    js: str(r.js),
    css: str(r.css),
    flags: normalizeFlags(r.flags),
    created: time(r.created) || time(r.updated),
    updated: time(r.updated),
  };
}

export const DEFAULT_SETTINGS = { hideBadge: false, sites: {}, updated: 0 };

export function normalizeSettings(s) {
  return {
    hideBadge: typeof s?.hideBadge === "boolean" ? s.hideBadge : DEFAULT_SETTINGS.hideBadge,
    sites: normalizeSites(s?.sites),
    updated: time(s?.updated),
  };
}

// "https://www.Example.com/path" 나 "example.com" → "www.example.com" / "example.com" (DragOn 과 같음). 아니면 null
export function normalizeHost(input) {
  const s = String(input || "").trim().toLowerCase();
  if (!s) return null;
  try {
    const host = new URL(/^[a-z]+:\/\//.test(s) ? s : "http://" + s).hostname;
    return /^[a-z0-9.-]+$/.test(host) && host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

// 주소 순으로 정렬해 둔다 (기기마다 JSON 이 같아야 합치기·비교가 왔다 갔다 하지 않는다)
export function normalizeSites(sites) {
  const out = {};
  if (!sites || typeof sites !== "object") return out;
  for (const host of Object.keys(sites).sort()) {
    const c = sites[host];
    if (normalizeHost(host) === host && (c?.copy || c?.strong)) out[host] = { copy: !!c.copy, strong: !!c.strong };
  }
  return out;
}

// { rules: {id: Rule}, settings }
export function normalizeState(s) {
  const rules = {};
  const list = Array.isArray(s?.rules) ? s.rules : Object.values(s?.rules || {});
  for (const r of list) {
    const n = normalizeRule(r);
    if (n) rules[n.id] = n;
  }
  return { rules, settings: normalizeSettings(s?.settings) };
}

export const liveRules = (rules) => Object.values(rules).filter((r) => !r.deleted);

// 실제로 넣을 JS · CSS 가 있는지 (비어 있거나 따로 꺼 두면 없음)
export const runsJs = (r) => !r.flags.offJS && !!r.js.trim();
export const runsCss = (r) => !r.flags.offCSS && !!r.css.trim();

export const sortByName = (list) =>
  list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko", { numeric: true }) || (a.urls || "").localeCompare(b.urls || "") || a.created - b.created);

// 내용이 같은지 (updated 같은 시각 정보는 빼고)
export function sameContent(a, b) {
  if (!a || !b) return a === b;
  if (a.deleted || b.deleted) return !!a.deleted === !!b.deleted;
  return a.name === b.name && a.urls === b.urls && a.js === b.js && a.css === b.css && FLAGS.every((k) => a.flags[k] === b.flags[k]);
}
