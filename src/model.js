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
// Jump = 검색 이동 키워드 (StayTab 에서 옮김, 아래 normalizeJump · src/jump.js)
// Settings = { hideBadge(아이콘에 규칙 수 숨기기, 기본 false = 표시), sites, restore, newtab, updated }
//   sites: 복사 제한 해제 { "example.com": { copy, strong } }. 둘 다 끈 사이트는 두지 않는다.
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

// restore: 창이 모두 닫혔다 다시 열리면 마지막 탭 복원 (StayTab 에서 옮김, 백그라운드 상주 중일 때만 의미 있음)
// newtab: 새 탭을 열면 바로 이 주소로 (StayTab 의 새 탭 리다이렉트)
export const DEFAULT_SETTINGS = { hideBadge: false, sites: {}, restore: false, newtab: { on: true, url: "https://www.naver.com/" }, updated: 0 };

export function normalizeSettings(s) {
  const nt = s?.newtab;
  return {
    hideBadge: typeof s?.hideBadge === "boolean" ? s.hideBadge : DEFAULT_SETTINGS.hideBadge,
    sites: normalizeSites(s?.sites),
    restore: typeof s?.restore === "boolean" ? s.restore : DEFAULT_SETTINGS.restore,
    newtab: {
      on: typeof nt?.on === "boolean" ? nt.on : DEFAULT_SETTINGS.newtab.on,
      url: typeof nt?.url === "string" ? nt.url : DEFAULT_SETTINGS.newtab.url,
    },
    updated: time(s?.updated),
  };
}

// "naver.com" → "https://naver.com/". 주소로 쓸 수 없으면 null (StayTab 과 같음)
export function normalizeUrl(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  // "localhost:3000" 은 스킴이 아니라 주소 → "://" 가 있거나 about: 같은 것만 스킴으로 본다
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^(about|edge|chrome):/i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (/^(javascript|data):$/i.test(u.protocol)) return null;
    if (/^https?:$/.test(u.protocol) && !u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.href;
  } catch {
    return null;
  }
}

// 검색 이동 키워드 하나. id = 키워드 (띄어쓰기 없이, 소문자. src/jump.js 의 jumpKey 와 같은 규칙)
//   { id, url, updated } | 삭제됨 { id, deleted, updated }
export function normalizeJump(j) {
  const id = typeof j?.id === "string" ? j.id.replace(/\s+/g, "").toLowerCase() : "";
  if (!id || id.length > 40) return null;
  if (j.deleted) return { id, deleted: time(j.deleted) || time(j.updated), updated: time(j.updated) || time(j.deleted) };
  const url = normalizeUrl(j.url);
  return url ? { id, url, updated: time(j.updated) } : null;
}

// "https://www.Example.com/path" 나 "example.com" → "www.example.com" / "example.com". 아니면 null.
// localhost · intranet 처럼 점이 없는 호스트도 받는다 (팝업은 지금 탭의 호스트를 그대로 넘긴다.
// 점을 요구하면 저장했다고 답하고도 목록에서 빠져 '저장이 안 되는' 것처럼 보였다)
export function normalizeHost(input) {
  const s = String(input || "").trim().toLowerCase();
  if (!s) return null;
  try {
    const host = new URL(/^[a-z]+:\/\//.test(s) ? s : "http://" + s).hostname;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host) ? host : null;
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

// { rules: {id: Rule}, jumps: {키워드: Jump}, settings }
export function normalizeState(s) {
  const pick = (v, fn) => {
    const out = {};
    for (const x of Array.isArray(v) ? v : Object.values(v || {})) {
      const n = fn(x);
      if (n) out[n.id] = n;
  }
    return out;
  };
  return { rules: pick(s?.rules, normalizeRule), jumps: pick(s?.jumps, normalizeJump), settings: normalizeSettings(s?.settings) };
}

export const liveJumps = (jumps) => Object.values(jumps).filter((j) => !j.deleted);

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
