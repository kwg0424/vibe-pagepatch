// 사이드바: Claude Code 와 대화하며 지금 탭을 고친다.
// background(src/bridge.js) ↔ 네이티브 호스트(bridge/host.mjs) ↔ claude -p.
// 사이드바를 열 때마다 새 대화 (팝업의 'AI와 고치기'를 다시 눌러도 새 대화 → newChatAt 신호).
const $ = (s) => document.querySelector(s);
const send = async (action, data = {}) => {
  const res = await chrome.runtime.sendMessage({ action, ...data });
  if (!res?.ok) throw new Error(res?.error || "실패했습니다");
  return res;
};

const win = await chrome.windows.getCurrent();
chrome.storage.session.remove(`chat:${win.id}`); // 예전(대화 이어 가기) 저장분 정리
let chat = { sessionId: null, items: [] };
let running = null; // 진행 중인 chatId
let currentText = null; // 지금 받아 쓰는 답 (items 안의 객체)
let sawDelta = false;
import { setupCommand } from "./src/bridgesetup.js";
const BRIDGE_SETUP = setupCommand(chrome.runtime.id); // 확장 안의 bridge 파일로 등록 (options.js 와 같게)

const TOOL_LABEL = {
  page_info: "페이지 확인",
  page_outline: "구조 살펴보기",
  page_query: "요소 찾기",
  page_screenshot: "화면 캡처",
  css_preview: "CSS 미리 적용",
  js_preview: "JS 미리 실행",
  preview_clear: "미리보기 지움",
  page_reload: "새로고침",
  page_console: "기록 확인",
  page_eval: "페이지에서 실행",
  rules_list: "규칙 목록",
  rule_get: "규칙 읽기",
  rule_save: "규칙 저장",
  rule_history: "변경 기록",
  rule_revert: "되돌리기",
};

// ── 연결 ──

const port = chrome.runtime.connect({ name: "sidepanel" });
port.onMessage.addListener((msg) => {
  if (msg.type === "status") renderStatus(msg);
  else if (msg.type === "chat-event" && msg.chatId === running) onEvent(msg.event);
  else if (msg.type === "chat-end" && msg.chatId === running) onEnd(msg);
});

let state = await send("state");
renderStatus(state.bridgeStatus || { state: "off" });

function renderStatus(st) {
  const s = st.state;
  // 초록 = Claude Code 연결됨, 빨강 = 그 밖 (연결 중·설치 필요·꺼짐 등은 마우스를 올리면)
  $("#dot").className = `dot ${s === "connected" && st.claude ? "ok" : "err"}`;
  $("#dot").title = { off: "Claude Code 연결 꺼짐", connecting: "연결 중", connected: st.claude ? "Claude Code 연결됨" : "claude 를 찾지 못함", "not-installed": "설치 필요", waiting: "다시 연결 중" }[s] ?? s;
  const setup = $("#setup");
  setup.replaceChildren();
  setup.classList.add("hidden");
  const notice = (html, button) => {
    const box = document.createElement("div");
    box.className = "notice";
    box.innerHTML = html;
    if (button) box.append(button);
    setup.append(box);
    setup.classList.remove("hidden");
  };
  const btn = (text, fn) => {
    const b = document.createElement("button");
    b.className = "btn small";
    b.textContent = text;
    b.onclick = fn;
    return b;
  };
  if (s === "off") {
    notice("Claude Code 연결이 꺼져 있습니다.<br>", btn("연결 켜기", () => send("bridge:config", { patch: { enabled: true } })));
  } else if (s === "not-installed") {
    notice(
      `PC 에 연결 프로그램을 한 번 등록해야 합니다 (Node.js 22+, Claude Code 필요). PowerShell 이나 cmd 에 붙여 넣으세요:<pre>${BRIDGE_SETUP}</pre>`,
      btn("복사", () => navigator.clipboard.writeText(BRIDGE_SETUP))
    );
    setup.lastChild.append(" 등록한 뒤 ", btn("다시 확인", () => send("bridge:retry")));
  } else if (s === "connected" && !st.claude) {
    notice(`Claude Code(claude)를 찾지 못했습니다. 설치한 뒤 PowerShell 이나 cmd 에서 다시 실행하세요:<pre>${BRIDGE_SETUP}</pre>`, btn("복사", () => navigator.clipboard.writeText(BRIDGE_SETUP)));
  } else if (s === "connected" && st.outdated) {
    notice(`연결 프로그램이 예전 버전입니다. PowerShell 이나 cmd 에 붙여 넣어 다시 등록하세요:<pre>${BRIDGE_SETUP}</pre>`, btn("복사", () => navigator.clipboard.writeText(BRIDGE_SETUP)));
  }
  updateComposer(s === "connected" && !!st.claude);
}

// ── 지금 탭 ──

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  return tab;
}

async function renderTab() {
  const tab = await activeTab();
  let host = "";
  try {
    host = new URL(tab.url).host;
  } catch {}
  $("#tabline").textContent = tab ? `${tab.title || ""} · ${host || tab.url}` : "";
  $("#tabline").title = tab?.url || "";
}
chrome.tabs.onActivated.addListener((i) => i.windowId === win.id && renderTab());
chrome.tabs.onUpdated.addListener((id, change, tab) => tab.windowId === win.id && tab.active && (change.url || change.title) && renderTab());
renderTab();

// ── 대화 표시 ──

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// 아주 간단한 마크다운: ```코드```, `코드`, **굵게**, 줄바꿈
function md(text) {
  const parts = text.split(/```[\w-]*\n?([\s\S]*?)(?:```|$)/g);
  return parts
    .map((p, i) => {
      if (i % 2) return `<pre><code>${esc(p.replace(/\n$/, ""))}</code></pre>`;
      return esc(p)
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
        .split(/\n{2,}/)
        .map((para) => (para.trim() ? `<p>${para.replace(/\n/g, "<br>")}</p>` : ""))
        .join("");
    })
    .join("");
}

function itemEl(item) {
  const el = document.createElement("div");
  if (item.role === "tool") {
    el.className = `tool ${item.status || ""}`;
    el.innerHTML = `<span class="ic"></span><span class="nm"></span><span class="sm"></span>`;
    el.querySelector(".nm").textContent = TOOL_LABEL[item.name] || item.name;
    el.querySelector(".sm").textContent = item.summary || "";
    if (item.result) el.title = item.result;
  } else {
    el.className = `msg ${item.role}`;
    if (item.role === "assistant") el.innerHTML = md(item.text || "");
    else el.textContent = item.text;
  }
  item.el = el;
  return el;
}

function renderAll() {
  const log = $("#log");
  for (const el of [...log.children]) if (el.id !== "intro") el.remove();
  $("#intro").classList.toggle("hidden", chat.items.length > 0);
  for (const item of chat.items) log.append(itemEl(item));
  scrollDown(true);
}

function add(item) {
  chat.items.push(item);
  $("#intro").classList.add("hidden");
  $("#log").append(itemEl(item));
  scrollDown(true);
  return item;
}

function refresh(item) {
  const old = item.el;
  old.replaceWith(itemEl(item));
  scrollDown();
}

function scrollDown(force = false) {
  const log = $("#log");
  if (force || log.scrollHeight - log.scrollTop - log.clientHeight < 120) log.scrollTop = log.scrollHeight;
}


renderAll();

// ── 보내기 ──

function updateComposer(ready = $("#send").dataset.ready === "1") {
  $("#send").dataset.ready = ready ? "1" : "0";
  $("#send").textContent = running ? "중지" : "보내기";
  $("#send").classList.toggle("primary", !running);
  $("#send").disabled = !running && !ready;
}

async function submit(text) {
  text = text.trim();
  if (!text || running) return;
  const tab = await activeTab();
  running = crypto.randomUUID();
  sawDelta = false;
  add({ role: "user", text });
  currentText = add({ role: "assistant", text: "" });
  currentText.el.classList.add("typing");
  $("#input").value = "";
  autoSize();
  updateComposer();
  port.postMessage({ type: "chat", chatId: running, text, sessionId: chat.sessionId, tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null });
}

function onEvent(ev) {
  if (ev.kind === "session") chat.sessionId = ev.sessionId;
  else if (ev.kind === "message-start") {
    sawDelta = false;
    if (!currentText || currentText.text) {
      currentText = add({ role: "assistant", text: "" });
      currentText.el.classList.add("typing");
    }
  } else if (ev.kind === "delta") {
    sawDelta = true;
    if (!currentText) currentText = add({ role: "assistant", text: "" });
    currentText.text += ev.text;
    refresh(currentText);
  } else if (ev.kind === "text") {
    if (currentText && !sawDelta) {
      currentText.text = ev.text;
      refresh(currentText);
    }
  } else if (ev.kind === "tool-call") {
    // 도구 줄은 지금 답 아래에. 그다음 답은 새 말풍선
    if (currentText && !currentText.text) {
      chat.items.splice(chat.items.indexOf(currentText), 1);
      currentText.el.remove();
    }
    currentText = null;
    add({ role: "tool", id: ev.id, name: ev.name, summary: ev.summary, status: "" });
  } else if (ev.kind === "tool-result") {
    const item = chat.items.find((i) => i.role === "tool" && i.id === ev.id);
    if (!item) return;
    item.status = ev.isError ? "err" : "ok";
    item.result = ev.text;
    refresh(item);
  }
}

function onEnd(msg) {
  running = null;
  if (msg.sessionId) chat.sessionId = msg.sessionId;
  // 빈 답 말풍선 정리
  chat.items = chat.items.filter((i) => {
    if (i.role === "assistant" && !i.text) {
      i.el?.remove();
      return false;
    }
    if (i.role === "tool" && !i.status) {
      i.status = "err";
      refresh(i);
    }
    return true;
  });
  currentText = null;
  if (msg.error) add({ role: "error", text: msg.error });
  updateComposer();
}

$("#send").onclick = () => {
  if (running) port.postMessage({ type: "chat-cancel", chatId: running });
  else submit($("#input").value);
};

function autoSize() {
  const t = $("#input");
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
}
$("#input").addEventListener("input", autoSize);
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!running) submit($("#input").value);
  }
});

for (const chip of document.querySelectorAll(".chip")) chip.onclick = () => submit(chip.textContent);

function newChat() {
  if (running) port.postMessage({ type: "chat-cancel", chatId: running });
  chat = { sessionId: null, items: [] };
  running = null;
  renderAll();
  updateComposer();
  $("#input").focus();
}
// 사이드바가 열려 있는 채로 팝업의 'AI와 고치기'를 다시 누르면 새 대화
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.newChatAt?.newValue?.windowId === win.id) newChat();
});

$("#openSettings").onclick = () => chrome.runtime.openOptionsPage();

$("#clearPreview").onclick = async () => {
  const tab = await activeTab();
  if (!tab) return;
  await chrome.scripting
    .executeScript({ target: { tabId: tab.id }, func: () => document.getElementById("pagepatch-preview")?.remove() })
    .catch(() => {});
};

$("#input").focus();
