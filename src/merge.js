// 두 동기화(브라우저 계정, WebDAV)가 같이 쓰는 합치기.
// 규칙·검색 이동 키워드는 항목마다 updated 가 늦은 쪽을 쓴다. 삭제도 { deleted } 표시로 같은 규칙을 따른다. 설정은 통째로.
// 같은 입력이면 어느 기기·어느 순서로 합쳐도 결과가 같다 → 두 경로로 같은 변경이 와도 왔다 갔다 하지 않는다.
import { normalizeState, TOMBSTONE_DAYS } from "./model.js";

// 시각이 같으면 내용으로 정한다 (기기마다 같은 쪽을 고르게)
function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.updated !== b.updated) return a.updated > b.updated ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

function mergeMap(a, b, limit) {
  const out = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const r = newer(a[id], b[id]);
    if (r.deleted && r.deleted < limit) continue;
    out[id] = r;
  }
  return out;
}

export function mergeStates(a, b, now = Date.now()) {
  a = normalizeState(a);
  b = normalizeState(b);
  const limit = now - TOMBSTONE_DAYS * 86400000;
  return { rules: mergeMap(a.rules, b.rules, limit), jumps: mergeMap(a.jumps, b.jumps, limit), settings: newer(a.settings, b.settings) };
}

const sameMap = (a, b) => {
  const ids = Object.keys(a);
  return ids.length === Object.keys(b).length && ids.every((id) => b[id] && JSON.stringify(a[id]) === JSON.stringify(b[id]));
};

export function sameState(a, b) {
  a = normalizeState(a);
  b = normalizeState(b);
  return JSON.stringify(a.settings) === JSON.stringify(b.settings) && sameMap(a.rules, b.rules) && sameMap(a.jumps, b.jumps);
}
