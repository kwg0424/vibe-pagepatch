// Claude Code 연결 (확장 쪽).
// Edge 가 네이티브 메시징으로 bridge/host.mjs 를 띄운다 (bridge/install.ps1 로 한 번 등록. 이 확장 ID 만 허용).
// host 는
//   - 사이드바 채팅: claude -p 를 띄워 대화하고, 진행 상황(chat-event)을 보내 준다
//   - 도구 중계: Claude Code(사이드바 채팅, 터미널 claude 둘 다)의 PagePatch 도구 요청을 여기로 보낸다 → tools.js
// 연결해 둔 동안 서비스 워커가 잠들지 않는다 (네이티브 포트가 열려 있으면 유지됨).
// local: bridge = { enabled, allowEval }
// session: bridgeStatus = { state, detail, at, claude, hostVersion }
//   state: off | connecting | connected | not-installed | waiting
//   outdated: 등록된 연결 프로그램이 이 확장에 든 것보다 예전 버전 → 등록 명령을 다시 실행해야 함
import { runTool } from "./tools.js";
import { BRIDGE_VERSION } from "../bridge/version.mjs";

export const HOST_NAME = "com.pagepatch.bridge";

export async function getBridgeConfig() {
  const { bridge } = await chrome.storage.local.get("bridge");
  return { enabled: false, allowEval: true, ...bridge };
}

export async function setBridgeConfig(patch) {
  const cfg = { ...(await getBridgeConfig()), ...patch };
  await chrome.storage.local.set({ bridge: { enabled: !!cfg.enabled, allowEval: !!cfg.allowEval } });
  await ensureBridge(true);
  return cfg;
}

async function setStatus(state, detail = "", extra = {}) {
  await chrome.storage.session.set({ bridgeStatus: { state, detail, at: Date.now(), ...extra } });
  broadcast({ type: "status", state, detail, ...extra });
}

let port = null;
let retryTimer = null;
const panels = new Set(); // 열린 사이드바들 (runtime.Port)
const chats = new Map(); // chatId → 사이드바 port

// 설정대로 연결 유지. retry=true 면 지금 다시 시도 (설정 화면 '다시 확인')
export async function ensureBridge(retry = false) {
  const cfg = await getBridgeConfig();
  if (!cfg.enabled) {
    disconnect();
    await setStatus("off");
    return;
  }
  if (port) return;
  if (retryTimer && !retry) return;
  clearTimeout(retryTimer);
  retryTimer = null;
  connect();
}

function disconnect() {
  clearTimeout(retryTimer);
  retryTimer = null;
  const p = port;
  port = null;
  p?.disconnect();
}

function connect() {
  setStatus("connecting");
  let p;
  try {
    p = chrome.runtime.connectNative(HOST_NAME);
  } catch (e) {
    setStatus("not-installed", e?.message || String(e));
    return;
  }
  port = p;
  p.onMessage.addListener(async (msg) => {
    if (msg.type === "hello") {
      await setStatus("connected", "", { claude: msg.claude || null, hostVersion: msg.version, mcpPort: msg.port, outdated: msg.version !== BRIDGE_VERSION });
    } else if (msg.type === "call") {
      let reply;
      try {
        reply = { type: "result", id: msg.id, result: await runTool(msg.tool, msg.args) };
      } catch (e) {
        reply = { type: "result", id: msg.id, error: e?.message || String(e) };
      }
      if (port === p) p.postMessage(reply);
    } else if (msg.type === "chat-event" || msg.type === "chat-end") {
      const panel = chats.get(msg.chatId);
      if (msg.type === "chat-end") chats.delete(msg.chatId);
      try {
        panel?.postMessage(msg);
      } catch {}
    }
  });
  p.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message || "";
    if (port !== p) return;
    port = null;
    for (const [chatId, panel] of chats) {
      try {
        panel.postMessage({ type: "chat-end", chatId, error: "Claude Code 연결이 끊겼습니다" });
      } catch {}
    }
    chats.clear();
    const notInstalled = /not found|not registered|forbidden|host/i.test(err) && !/exited/i.test(err);
    setStatus(notInstalled ? "not-installed" : "waiting", err);
    // 설치 안 됨이면 자주 다시 시도할 이유가 없다 (설정 화면에서 '다시 확인')
    retryTimer = setTimeout(() => {
      retryTimer = null;
      ensureBridge();
    }, notInstalled ? 300000 : 5000);
  });
  p.postMessage({ type: "hello", version: chrome.runtime.getManifest().version });
}

function broadcast(msg) {
  for (const panel of panels) {
    try {
      panel.postMessage(msg);
    } catch {}
  }
}

// 사이드바 연결: { type: "chat", chatId, text, sessionId, tab } / { type: "chat-cancel", chatId }
export function attachPanel(panel) {
  panels.add(panel);
  panel.onDisconnect.addListener(() => {
    panels.delete(panel);
    for (const [chatId, p] of chats) {
      if (p !== panel) continue;
      chats.delete(chatId);
      port?.postMessage({ type: "chat-cancel", chatId });
    }
  });
  panel.onMessage.addListener(async (msg) => {
    if (msg.type === "chat") {
      await ensureBridge();
      if (!port) {
        panel.postMessage({ type: "chat-end", chatId: msg.chatId, error: "Claude Code 에 연결되지 않았습니다" });
        return;
      }
      chats.set(msg.chatId, panel);
      port.postMessage({ type: "chat", chatId: msg.chatId, text: msg.text, sessionId: msg.sessionId || null, tab: msg.tab });
    } else if (msg.type === "chat-cancel") {
      port?.postMessage({ type: "chat-cancel", chatId: msg.chatId });
    }
  });
}
