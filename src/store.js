// 규칙·설정 저장 (chrome.storage.local). 값을 바꾸는 함수는 background 만 부른다 → serial 로 한 줄로 처리.
// local: { rules: {id: Rule}, settings, history: {id: [버전…]} }
// 변경 기록: 규칙마다 최근 20개 버전 (이 PC 에만, 동기화 안 함). 최신이 앞.
import { normalizeState, normalizeRule, normalizeSettings, newId, sameContent, NEW_RULE_FLAGS } from "./model.js";
import { mergeStates, sameState } from "./merge.js";

const HISTORY_MAX = 20;

let queue = Promise.resolve();
export function serial(fn) {
  const run = queue.then(() => fn());
  queue = run.catch(() => {});
  return run;
}

export async function getState() {
  const { rules, settings } = await chrome.storage.local.get(["rules", "settings"]);
  return normalizeState({ rules, settings });
}

// input: { id?, name?, urls?, js?, css?, flags?: 일부만 } → 바뀐 것만 덮어쓴다. by: "user" | "claude" | "import" | "revert"
export function saveRule(input, by = "user") {
  return serial(async () => {
    const state = await getState();
    const prev = input.id && state.rules[input.id] && !state.rules[input.id].deleted ? state.rules[input.id] : null;
    const now = Date.now();
    const rule = normalizeRule({
      ...(prev || { name: "", urls: "", js: "", css: "" }),
      ...input,
      flags: { ...(prev ? prev.flags : NEW_RULE_FLAGS), ...input.flags }, // 새 규칙(Claude 가 옵션 없이 만든 것 포함)은 처음 옵션부터
      id: input.id || newId(),
      created: prev?.created || now,
      updated: now,
    });
    if (prev && sameContent(prev, rule)) return prev;
    state.rules[rule.id] = rule;
    await chrome.storage.local.set({ rules: state.rules });
    await addHistory([rule], by);
    return rule;
  });
}

export function deleteRule(id) {
  return serial(async () => {
    const state = await getState();
    if (!state.rules[id] || state.rules[id].deleted) return;
    const now = Date.now();
    state.rules[id] = { id, deleted: now, updated: now };
    const { history = {} } = await chrome.storage.local.get("history");
    delete history[id];
    await chrome.storage.local.set({ rules: state.rules, history });
  });
}

export function saveSettings(patch) {
  return serial(async () => {
    const { settings } = await getState();
    const next = normalizeSettings({ ...settings, ...patch, updated: Date.now() });
    await chrome.storage.local.set({ settings: next });
    return next;
  });
}

// 우클릭·복사 허용 사이트 바꾸기: fn(지금 sites 복사본) 이 고친 sites 를 돌려준다 → 바뀐 settings
// (둘 다 끈 사이트는 normalizeSettings 가 뺀다)
export function updateSites(fn) {
  return serial(async () => {
    const { settings } = await getState();
    const next = normalizeSettings({ ...settings, sites: fn({ ...settings.sites }), updated: Date.now() });
    if (JSON.stringify(next.sites) === JSON.stringify(settings.sites)) return settings;
    await chrome.storage.local.set({ settings: next });
    return next;
  });
}

// 다른 곳(동기화·가져오기)에서 온 상태를 합친다 → { state, changed }
export function mergeIn(incoming, by) {
  return serial(async () => {
    const local = await getState();
    const merged = mergeStates(local, incoming);
    if (sameState(merged, local)) return { state: local, changed: false };
    await chrome.storage.local.set({ rules: merged.rules, settings: merged.settings });
    await addHistory(
      Object.values(merged.rules).filter((r) => !r.deleted && !sameContent(local.rules[r.id], r)),
      by
    );
    return { state: merged, changed: true };
  });
}

// 서버 연결 때 "서버 규칙 쓰기": 이 기기 규칙을 통째로 바꾼다
export function replaceAll(incoming, by) {
  return serial(async () => {
    const local = await getState();
    const next = { rules: incoming.rules, settings: incoming.settings };
    await chrome.storage.local.set(next);
    await addHistory(
      Object.values(next.rules).filter((r) => !r.deleted && !sameContent(local.rules[r.id], r)),
      by
    );
    return next;
  });
}

// 서버 연결 때 "이 기기 규칙 올리기": 이 기기 규칙이 이기도록 시각을 지금으로, 서버에만 있는 규칙은 삭제 표시
export function preferLocal(remoteIds) {
  return serial(async () => {
    const state = await getState();
    const now = Date.now();
    for (const r of Object.values(state.rules)) r.updated = now;
    for (const id of remoteIds) if (!state.rules[id]) state.rules[id] = { id, deleted: now, updated: now };
    state.settings = { ...state.settings, updated: now };
    await chrome.storage.local.set({ rules: state.rules, settings: state.settings });
  });
}

// 가져오기: 같은 id 는 가져온 것으로 바꾼다 (updated 가 지금이라 합치기에서 이긴다)
export function importState(imported) {
  return mergeIn({ rules: imported.rules, settings: imported.settings || undefined }, "import");
}

async function addHistory(rules, by) {
  if (!rules.length) return;
  const { history = {} } = await chrome.storage.local.get("history");
  for (const r of rules) {
    const list = history[r.id] || [];
    list.unshift({ t: r.updated || Date.now(), by, name: r.name, urls: r.urls, js: r.js, css: r.css, flags: r.flags });
    history[r.id] = list.slice(0, HISTORY_MAX);
  }
  await chrome.storage.local.set({ history });
}

export async function getHistory(id) {
  const { history = {} } = await chrome.storage.local.get("history");
  return history[id] || [];
}

export async function revertRule(id, index, by = "revert") {
  const list = await getHistory(id);
  const v = list[index];
  if (!v) throw new Error("그 버전이 없습니다");
  return saveRule({ id, name: v.name, urls: v.urls, js: v.js, css: v.css, flags: v.flags }, by);
}

export function emptyState() {
  return normalizeState(null);
}
