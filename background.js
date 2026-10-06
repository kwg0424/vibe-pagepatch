// PagePatch 서비스 워커.
//   - 규칙 저장(유일한 쓰기 담당) → userScripts 등록·탭 CSS·배지 갱신 → 동기화 예약
//   - 팝업·설정·사이드바 메시지 처리
//   - Claude Code 연결 유지 (src/bridge.js)
//   - 우클릭·복사 허용 (DragOn 에서 옮김, src/unlock.js)
import { getState, saveRule, deleteRule, saveSettings, updateSites, importState, getHistory, revertRule } from "./src/store.js";
import { applyUnlock, injectUnlock, unlockHost } from "./src/unlock.js";
import { syncRegistrations, applyTab, applyAllTabs, forgetTab, matchingRules, userScriptsAvailable, spaNavigate, updateRuns, getRuns } from "./src/inject.js";
import { importData, exportState } from "./src/import.js";
import { scheduleSync, runSync, syncNow, syncStatusView, connectServer, disconnectServer } from "./src/sync.js";
import { getBridgeConfig, setBridgeConfig, ensureBridge, attachPanel } from "./src/bridge.js";
import { initTools } from "./src/tools.js";
import { liveRules, sortByName, normalizeHost } from "./src/model.js";
import { WARN_BYTES, QUOTA } from "./src/syncitems.js";

// 아이콘의 규칙 수: 브라우저 배지는 글자 위치를 바꿀 수 없어서 아이콘 위에 직접 그린다
// (초록 알약 + 검은 숫자, 가운데 정렬). 크기별로 알약 높이·글자 크기를 따로 정한다
const BADGE_COLOR = "#22c55e";
// h: 알약 높이, ring: 검은 테두리 두께 (아이콘 파랑과 구분), lift: 글자를 위로 (아래 여백을 넉넉히)
const BADGE_SIZES = { 16: { h: 10, font: 9, ring: 1, lift: 0.5 }, 24: { h: 12, font: 10, ring: 1, lift: 0.5 }, 32: { h: 16, font: 12, ring: 1.5, lift: 1 } };
const ICON_PATHS = { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" };
let baseIcons = null;

async function loadBaseIcons() {
  if (baseIcons) return baseIcons;
  const out = {};
  for (const size of Object.keys(BADGE_SIZES)) {
    const blob = await (await fetch(chrome.runtime.getURL(`icons/icon-${size === "24" ? 32 : size}.png`))).blob(); // 24 는 32 를 줄여서
    out[size] = await createImageBitmap(blob);
  }
  return (baseIcons = out);
}

function drawCount(bitmap, size, text) {
  const { h, font, ring, lift } = BADGE_SIZES[size];
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext("2d");
  g.drawImage(bitmap, 0, 0, size, size);
  g.font = `bold ${font}px "Segoe UI", Arial, sans-serif`;
  const m = g.measureText(text);
  const w = Math.max(h, Math.ceil(m.width + h * 0.6));
  const x = size - w;
  const y = size - h;
  // 검은 테두리: 바깥 알약(검정)을 그리고 안쪽을 초록으로
  g.fillStyle = "#000000";
  g.beginPath();
  g.roundRect(x, y, w, h, h / 2);
  g.fill();
  g.fillStyle = BADGE_COLOR;
  g.beginPath();
  g.roundRect(x + ring, y + ring, w - ring * 2, h - ring * 2, (h - ring * 2) / 2);
  g.fill();
  g.fillStyle = "#000000";
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  // 글자의 실제 높이로 세로 가운데
  g.fillText(text, x + w / 2, y + h / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 - lift);
  return g.getImageData(0, 0, size, size);
}

// ── 규칙 반영 ──

async function refresh() {
  const state = await getState();
  let result = { available: userScriptsAvailable(), errors: {} };
  try {
    result = await syncRegistrations(state);
  } catch (e) {
    console.warn("userScripts", e);
  }
  await chrome.storage.session.set({ ruleErrors: result.errors, userScripts: result.available });
  await applyAllTabs(state);
  await updateAllBadges(state);
  return result;
}

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch((e) => console.warn("refresh", e)), 300);
}

async function updateBadge(tabId, url, state) {
  const n = !state.settings.hideBadge && /^(https?|file):/.test(url || "") ? matchingRules(state, url).filter((r) => !r.flags.off).length : 0;
  try {
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {}); // 예전 버전이 탭마다 남긴 배지
    if (!n) {
      await chrome.action.setIcon({ tabId, path: ICON_PATHS });
      return;
    }
    const icons = await loadBaseIcons();
    const text = n > 99 ? "99" : String(n);
    const imageData = Object.fromEntries(Object.keys(BADGE_SIZES).map((s) => [s, drawCount(icons[s], Number(s), text)]));
    await chrome.action.setIcon({ tabId, imageData });
  } catch {} // 닫힌 탭
}

async function updateAllBadges(state) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((t) => updateBadge(t.id, t.url, state)));
}

initTools({ refresh, getBridgeConfig });

// ── 이벤트 ──

chrome.runtime.onInstalled.addListener(() => startup());
chrome.runtime.onStartup.addListener(() => startup());

async function startup() {
  chrome.alarms.create("tick", { periodInMinutes: 1 });
  await refresh().catch((e) => console.warn("refresh", e));
  syncNow().catch(() => {});
}

// 서비스 워커가 다시 뜰 때마다
ensureBridge();
chrome.action.setBadgeText({ text: "" }); // 예전 버전의 브라우저 배지 지우기

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "tick") return;
  ensureBridge();
  // 사용자 스크립트 허용을 켜고 끈 것을 알아챈다
  const { userScripts } = await chrome.storage.session.get("userScripts");
  if (userScripts !== userScriptsAvailable()) scheduleRefresh();
  // WebDAV 는 다른 기기의 변경을 알려 주지 않으므로 15분마다 받아 온다
  const { syncStatus = {} } = await chrome.storage.local.get("syncStatus");
  if (Date.now() - (syncStatus.webdav?.at || 0) > 15 * 60000) runSync("webdav").catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.rules || changes.settings)) {
    scheduleRefresh();
    scheduleSync("browser", 3000);
    scheduleSync("webdav", 5000);
  } else if (area === "sync") {
    scheduleSync("browser", 1500);
  }
});

// 우클릭·복사 허용: 페이지 로드가 끝나면 (DragOn 과 같은 시점)
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete" || !unlockHost(tab.url)) return;
  applyUnlock(tabId, tab.url, (await getState()).settings);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  forgetTab(tabId);
  const { logs = {} } = await chrome.storage.session.get("logs");
  if (logs[tabId]) {
    delete logs[tabId];
    await chrome.storage.session.set({ logs });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "sidepanel") attachPanel(port);
});

// ── 메시지 ──

let logsQueue = Promise.resolve();

const handlers = {
  // content.js
  async "page:open"(msg, sender) {
    if (!sender.tab || sender.frameId !== 0) return;
    // 실행 상태부터 비운다 (이 뒤에 오는 규칙 실행 알림이 지워지지 않게 먼저 줄 세움)
    const tabId = sender.tab.id;
    const reset = updateRuns(tabId, () => ({ spa: false, rules: {} }));
    logsQueue = logsQueue
      .then(async () => {
        const { logs = {} } = await chrome.storage.session.get("logs");
        if (!logs[tabId]) return;
        delete logs[tabId];
        await chrome.storage.session.set({ logs });
      })
      .catch(() => {});
    const state = await getState();
    await reset;
    await applyTab(sender.tab.id, msg.url, state, { fresh: true });
    await updateBadge(sender.tab.id, msg.url, state);
  },
  async "page:update"(msg, sender) {
    if (!sender.tab || sender.frameId !== 0) return;
    const state = await getState();
    await applyTab(sender.tab.id, msg.url, state);
    await spaNavigate(sender.tab.id, msg.url, state);
    await updateBadge(sender.tab.id, msg.url, state);
  },
  async log(msg, sender) {
    if (!sender.tab) return;
    const e = msg.entry || {};
    if (["ran", "waiting", "error"].includes(e.level) && e.rule) {
      await updateRuns(sender.tab.id, (t) => {
        const prev = t.rules[e.rule];
        // 다른 프레임에서 이미 실행됐으면 그 프레임의 waiting 으로 덮지 않는다
        if (e.level === "waiting" && prev?.status === "ran") return;
        t.rules[e.rule] = { status: e.level, url: e.url, t: Date.now(), frame: e.frame, ...(e.level === "error" ? { error: String(e.message || "").slice(0, 500) } : {}) };
      });
      if (e.level !== "error") return;
    }
    const rule = (await getState()).rules[e.rule];
    // 여러 기록이 한꺼번에 와도 서로 덮어쓰지 않게 한 줄로
    logsQueue = logsQueue.then(async () => {
      const { logs = {} } = await chrome.storage.session.get("logs");
      const list = logs[sender.tab.id] || [];
      list.push({ ...e, ruleName: rule?.name || "", message: String(e.message || "").slice(0, 2000) });
      logs[sender.tab.id] = list.slice(-200);
      await chrome.storage.session.set({ logs });
    }).catch(() => {});
    await logsQueue;
  },

  // 화면들
  async state() {
    const state = await getState();
    const [{ ruleErrors = {}, bridgeStatus = { state: "off" } }, sync, bridge] = await Promise.all([
      chrome.storage.session.get(["ruleErrors", "bridgeStatus"]),
      syncStatusView(),
      getBridgeConfig(),
    ]);
    return {
      rules: sortByName(liveRules(state.rules)),
      settings: state.settings,
      errors: ruleErrors,
      userScripts: userScriptsAvailable(),
      sync,
      syncLimits: { warn: WARN_BYTES, quota: QUOTA },
      bridge,
      bridgeStatus,
      extensionId: chrome.runtime.id,
    };
  },
  async popup({ url, tabId }) {
    const state = await getState();
    const { ruleErrors = {}, bridgeStatus = { state: "off" } } = await chrome.storage.session.get(["ruleErrors", "bridgeStatus"]);
    const injectable = /^(https?|file):/.test(url || "");
    const host = unlockHost(url);
    return {
      injectable,
      unlock: host ? { host, ...(state.settings.sites[host] || { copy: false, strong: false }) } : null,
      rules: injectable ? matchingRules(state, url) : [],
      runs: tabId ? await getRuns(tabId) : { spa: false, rules: {} },
      errors: ruleErrors,
      userScripts: userScriptsAvailable(),
      bridgeStatus,
    };
  },
  async "rule:save"({ rule }) {
    const saved = await saveRule(rule, "user");
    const { errors } = await refresh();
    return { rule: saved, error: errors[saved.id] || null };
  },
  async "rule:toggle"({ id, off }) {
    const saved = await saveRule({ id, flags: { off } }, "user");
    await refresh();
    return { rule: saved };
  },
  async "rule:delete"({ id }) {
    await deleteRule(id);
    await refresh();
    return {};
  },
  async "rule:history"({ id }) {
    return { versions: await getHistory(id) };
  },
  async "rule:revert"({ id, index }) {
    const rule = await revertRule(id, index, "revert");
    await refresh();
    return { rule };
  },
  async settings({ patch }) {
    const settings = await saveSettings(patch);
    await updateAllBadges(await getState());
    return { settings };
  },
  // 우클릭·복사 허용. mode: copy | strong. 켤 때는 tabId 의 페이지에 바로 넣는다
  async "unlock:set"({ host, mode, value, tabId }) {
    if (!["copy", "strong"].includes(mode)) throw new Error("알 수 없는 모드입니다");
    if (value && tabId != null) injectUnlock(tabId, mode);
    const settings = await updateSites((sites) => ({ ...sites, [host]: { ...sites[host], [mode]: !!value } }));
    return { sites: settings.sites };
  },
  async "unlock:add"({ host: input }) {
    const host = normalizeHost(input);
    if (!host) throw new Error("올바른 사이트 주소가 아닙니다.");
    if ((await getState()).settings.sites[host]) throw new Error(`${host} 은(는) 이미 목록에 있습니다.`);
    const settings = await updateSites((sites) => ({ ...sites, [host]: { copy: true, strong: false } }));
    return { host, sites: settings.sites };
  },
  async "unlock:remove"({ host }) {
    const settings = await updateSites((sites) => {
      delete sites[host];
      return sites;
    });
    return { sites: settings.sites };
  },
  async import({ json }) {
    const { state, report } = importData(json);
    await importState(state);
    await refresh();
    return { report };
  },
  async export() {
    return { json: exportState(await getState()) };
  },
  async "sync:connect"(msg) {
    return connectServer(msg);
  },
  async "sync:now"() {
    return { action: await syncNow() };
  },
  async "sync:disconnect"() {
    return disconnectServer();
  },
  async "bridge:config"({ patch }) {
    return { bridge: await setBridgeConfig(patch) };
  },
  async "bridge:retry"() {
    await ensureBridge(true);
    return {};
  },
  async "userscripts:check"() {
    const r = await refresh();
    return { available: r.available };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fn = handlers[msg?.action];
  if (!fn) return false;
  Promise.resolve(fn(msg, sender))
    .then((res) => sendResponse({ ok: true, ...res }))
    .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
  return true;
});
