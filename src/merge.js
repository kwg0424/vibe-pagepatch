// 두 동기화(브라우저 계정, WebDAV)가 같이 쓰는 합치기.
// 규칙마다 updated 가 늦은 쪽을 쓴다. 삭제도 { deleted } 표시로 같은 규칙을 따른다.
// 같은 입력이면 어느 기기·어느 순서로 합쳐도 결과가 같다 → 두 경로로 같은 변경이 와도 왔다 갔다 하지 않는다.
import { normalizeState, TOMBSTONE_DAYS } from "./model.js";

// 시각이 같으면 내용으로 정한다 (기기마다 같은 쪽을 고르게)
function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.updated !== b.updated) return a.updated > b.updated ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

export function mergeStates(a, b, now = Date.now()) {
  a = normalizeState(a);
  b = normalizeState(b);
  const rules = {};
  const limit = now - TOMBSTONE_DAYS * 86400000;
  for (const id of new Set([...Object.keys(a.rules), ...Object.keys(b.rules)])) {
    const r = newer(a.rules[id], b.rules[id]);
    if (r.deleted && r.deleted < limit) continue;
    rules[id] = r;
  }
  return { rules, settings: newer(a.settings, b.settings) };
}

export function sameState(a, b) {
  a = normalizeState(a);
  b = normalizeState(b);
  const ids = Object.keys(a.rules);
  if (ids.length !== Object.keys(b.rules).length) return false;
  if (JSON.stringify(a.settings) !== JSON.stringify(b.settings)) return false;
  return ids.every((id) => b.rules[id] && JSON.stringify(a.rules[id]) === JSON.stringify(b.rules[id]));
}
