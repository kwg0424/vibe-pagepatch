// 브라우저 계정 동기화(chrome.storage.sync)에 넣을 항목 모양.
// 한도: 전체 100 KB, 항목당 8 KB(키 + JSON 값), 항목 512개.
//   settings          → 설정
//   rule:<id>         → 규칙 하나
//   rule:<id>#<n>     → 8 KB 를 넘는 규칙은 JSON 문자열을 조각으로 나눠 담고, rule:<id> 에는 { id, chunks, updated } 만
//   jump:<키워드>     → 검색 이동 키워드 하나 (작아서 조각 없음)
import { normalizeState } from "./model.js";

export const RULE_PREFIX = "rule:";
export const JUMP_PREFIX = "jump:";
export const SETTINGS_KEY = "settings";
export const ITEM_MAX = 8192 - 64;
export const QUOTA = 102400;
export const WARN_BYTES = 80 * 1024;

const bytes = (s) => new TextEncoder().encode(s).length;

function split(s, maxBytes) {
  const parts = [];
  let i = 0;
  while (i < s.length) {
    let n = Math.min(s.length - i, maxBytes);
    while (n > 1 && bytes(JSON.stringify(s.slice(i, i + n))) > maxBytes) n = Math.floor(n * 0.8);
    if (n > 1 && /[\uD800-\uDBFF]/.test(s[i + n - 1])) n--; // 서로게이트 쌍을 자르지 않게
    parts.push(s.slice(i, i + n));
    i += n;
  }
  return parts;
}

export function toItems(state) {
  const items = { [SETTINGS_KEY]: state.settings };
  for (const r of Object.values(state.rules)) {
    const key = RULE_PREFIX + r.id;
    const json = JSON.stringify(r);
    if (bytes(key) + bytes(json) <= ITEM_MAX) {
      items[key] = r;
      continue;
    }
    const parts = split(json, ITEM_MAX - bytes(key) - 8);
    items[key] = { id: r.id, chunks: parts.length, updated: r.updated };
    parts.forEach((p, i) => (items[`${key}#${i}`] = p));
  }
  for (const j of Object.values(state.jumps || {})) items[JUMP_PREFIX + j.id] = j;
  return items;
}

export function fromItems(items) {
  const rules = {};
  const jumps = {};
  for (const [k, v] of Object.entries(items || {})) {
    if (k.startsWith(JUMP_PREFIX)) {
      if (v?.id) jumps[v.id] = v;
      continue;
    }
    if (!k.startsWith(RULE_PREFIX) || k.includes("#") || !v) continue;
    if (v.chunks) {
      let json = "";
      for (let i = 0; i < v.chunks; i++) {
        const p = items[`${k}#${i}`];
        if (typeof p !== "string") {
          json = null;
          break;
        }
        json += p;
      }
      if (json === null) continue; // 조각이 아직 다 안 왔음 → 다음 동기화에서
      try {
        const r = JSON.parse(json);
        if (r?.id) rules[r.id] = r;
      } catch {}
    } else if (v.id) rules[v.id] = v;
  }
  return normalizeState({ rules, jumps, settings: items?.[SETTINGS_KEY] });
}

// 지금 storage.sync 내용 → 원하는 내용 으로 바꾸려면 { set, remove }
export function diffItems(current, desired) {
  const set = {};
  for (const [k, v] of Object.entries(desired)) if (JSON.stringify(current[k]) !== JSON.stringify(v)) set[k] = v;
  const remove = Object.keys(current).filter((k) => !(k in desired));
  return { set, remove };
}

export const itemsBytes = (items) => Object.entries(items).reduce((n, [k, v]) => n + bytes(k) + bytes(JSON.stringify(v)), 0);
