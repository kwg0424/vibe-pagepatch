// 동기화: 브라우저 계정 / 서버(WebDAV) 중 하나 (EdgeMark · StayTab 과 같은 방식).
//   browser (기본): chrome.storage.sync. Edge 에 로그인하고 확장 동기화를 켜 둔 PC 끼리
//   server        : 사용자 WebDAV 서버에 암호화한 파일 하나. 서버 모드에서는 storage.sync 를 건드리지 않는다
// 둘 다 이 PC 의 규칙(storage.local)과 합치는 방식이다 (규칙마다 늦게 고친 쪽, 삭제 표시 30일).
// local: syncConfig = { mode, webdav: { url, username, password } }
//        syncStatus = { browser: { at, error, action, bytes }, webdav: { at, error, action } }
import { getState, mergeIn, replaceAll, preferLocal } from "./store.js";
import { sameState } from "./merge.js";
import { normalizeState, sameContent } from "./model.js";
import { toItems, fromItems, diffItems, QUOTA } from "./syncitems.js";
import { pullVault, pushVault, assertSecureUrl, folderUrl } from "./webdav.js";
import { encryptVault, decryptVault, WrongKeyError } from "./crypto.js";
import { credentialSecret, hasCredentials } from "./key.js";

const EMPTY_WEBDAV = { url: "", username: "", password: "" };

export async function getSyncConfig() {
  const { syncConfig: c } = await chrome.storage.local.get("syncConfig");
  const webdav = { ...EMPTY_WEBDAV, ...c?.webdav };
  delete webdav.enabled;
  return { mode: c?.mode === "server" ? "server" : "browser", webdav };
}

const setSyncConfig = (cfg) => chrome.storage.local.set({ syncConfig: cfg });

async function setStatus(kind, patch) {
  const { syncStatus = {} } = await chrome.storage.local.get("syncStatus");
  syncStatus[kind] = { ...syncStatus[kind], ...patch };
  await chrome.storage.local.set({ syncStatus });
}

// 같은 종류의 동기화는 한 번에 하나씩 (돌고 있으면 끝난 뒤 이어서 한 번 더 → 그 사이 바뀐 것까지)
const running = {};
function once(kind, fn) {
  const p = (running[kind] || Promise.resolve())
    .catch(() => {})
    .then(fn)
    .finally(() => {
      if (running[kind] === p) delete running[kind];
    });
  running[kind] = p;
  return p;
}

// ── 브라우저 계정 ──

export function syncBrowser() {
  return once("browser", async () => {
    try {
      const remote = await chrome.storage.sync.get(null);
      const { state, changed } = await mergeIn(fromItems(remote), "sync");
      const { set, remove } = diffItems(remote, toItems(state));
      if (Object.keys(set).length) await chrome.storage.sync.set(set);
      if (remove.length) await chrome.storage.sync.remove(remove);
      const bytes = await chrome.storage.sync.getBytesInUse(null);
      const pushed = Object.keys(set).length || remove.length;
      const action = changed && pushed ? "merged" : changed ? "pulled" : pushed ? "pushed" : "unchanged";
      await setStatus("browser", { at: Date.now(), error: null, action, bytes });
      return action;
    } catch (e) {
      const msg = /QUOTA/i.test(e?.message || "") ? `브라우저 동기화 용량(${QUOTA / 1024} KB)을 넘었습니다. 큰 규칙을 줄이거나 서버(WebDAV) 동기화를 쓰세요` : e?.message || String(e);
      await setStatus("browser", { at: Date.now(), error: msg });
      throw new Error(msg);
    }
  });
}

// ── 서버(WebDAV) ──

async function readServer(cfg) {
  const remote = await pullVault(cfg);
  let state = null;
  if (remote.blob) {
    try {
      state = normalizeState(await decryptVault(remote.blob, credentialSecret(cfg)));
    } catch (e) {
      if (!(e instanceof WrongKeyError)) throw e; // 못 여는 파일 → 이 기기 규칙으로 다시 쓴다
    }
  }
  return { remote, state };
}

export function syncWebdav() {
  return once("webdav", async () => {
    const { mode, webdav: cfg } = await getSyncConfig();
    if (mode !== "server" || !cfg.url || !hasCredentials(cfg)) return "off";
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { remote, state: remoteState } = await readServer(cfg);
        const { state, changed } = remoteState ? await mergeIn(remoteState, "sync") : { state: await getState(), changed: false };
        let action = changed ? "pulled" : "unchanged";
        if (!remoteState || !sameState(state, remoteState)) {
          const blob = await encryptVault({ app: "PagePatch", v: 1, rules: state.rules, jumps: state.jumps, settings: state.settings }, credentialSecret(cfg), remoteState ? remote.blob : undefined);
          const res = await pushVault(cfg, remote.etag, blob);
          if (res.conflict) continue; // 그 사이 다른 기기가 올림 → 다시 받아서 합친다
          action = changed ? "merged" : remote.blob ? "pushed" : "created";
        }
        await setStatus("webdav", { at: Date.now(), error: null, action });
        return action;
      }
      throw new Error("동기화하는 동안 서버 파일이 계속 바뀝니다. 잠시 뒤 다시 시도하세요");
    } catch (e) {
      await setStatus("webdav", { at: Date.now(), error: e?.message || String(e) });
      throw e;
    }
  });
}

const liveIds = (s) => Object.values(s.rules).filter((r) => !r.deleted).map((r) => r.id);

function sameLive(a, b) {
  const ids = liveIds(a);
  return ids.length === liveIds(b).length && ids.every((id) => b.rules[id] && !b.rules[id].deleted && sameContent(a.rules[id], b.rules[id]));
}

// 서버 연결. 서버와 이 기기 둘 다 규칙이 있고 내용이 다르면 { ask: true } → 화면이 고르게 한 뒤 choice 로 다시 부른다
//   choice: merge(합치기) | remote(서버 규칙 쓰기) | local(이 기기 규칙 올리기)
export async function connectServer({ url, username, password, choice }) {
  const cur = await getSyncConfig();
  url = folderUrl(String(url || ""));
  username = String(username || "").trim();
  // 비밀번호를 비우면 같은 서버·아이디일 때 저장된 것을 쓴다
  if (!password && cur.webdav.url === url && cur.webdav.username === username) password = cur.webdav.password;
  if (!url || !username || !password) throw new Error("서버 주소·아이디·비밀번호를 모두 넣으세요");
  assertSecureUrl(url);
  const cfg = { url, username, password };

  const { state: remoteState } = await readServer(cfg);
  const local = await getState();
  if (!choice && remoteState && liveIds(remoteState).length && liveIds(local).length && !sameLive(local, remoteState)) return { ask: true };

  await setSyncConfig({ mode: "server", webdav: cfg });
  if (choice === "remote" && remoteState) await replaceAll(remoteState, "sync");
  else if (choice === "local" && remoteState) await preferLocal(remoteState);
  return { action: await syncWebdav() };
}

// 브라우저 동기화로 전환: 서버 연결 정보를 지우고, 지금 규칙을 브라우저 동기화와 합친다. 서버 파일은 그대로
export async function disconnectServer() {
  await setSyncConfig({ mode: "browser", webdav: EMPTY_WEBDAV });
  await chrome.storage.local.set({ syncStatus: {} });
  return { action: await syncBrowser() };
}

// ── 예약 ──

// 변경 뒤 몇 초 모아서 (storage.sync 는 분당 쓰기 120회 한도)
const timers = {};
export function scheduleSync(kind, delay) {
  clearTimeout(timers[kind]);
  timers[kind] = setTimeout(() => runSync(kind).catch(() => {}), delay);
}

export async function runSync(kind) {
  const { mode } = await getSyncConfig();
  if (kind === "browser") return mode === "browser" ? syncBrowser() : "off";
  if (kind === "webdav") return mode === "server" ? syncWebdav() : "off";
}

export async function syncNow() {
  const { mode } = await getSyncConfig();
  return mode === "server" ? syncWebdav() : syncBrowser();
}

export async function syncStatusView() {
  const [{ mode, webdav }, { syncStatus = {} }] = await Promise.all([getSyncConfig(), chrome.storage.local.get("syncStatus")]);
  return { mode, url: webdav.url, username: webdav.username, hasPassword: !!webdav.password, browser: syncStatus.browser || null, server: syncStatus.webdav || null };
}
