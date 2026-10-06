// 사이드바: Claude Code 와 대화하며 지금 탭을 고친다.
// background(src/bridge.js) ↔ 네이티브 호스트(bridge/host.mjs) ↔ claude -p.
// 대화 내용은 창마다 session 저장소에 둔다 (사이드바를 닫았다 열어도 이어짐, 브라우저를 끄면 사라짐).
const $ = (s) => document.querySelector(s);
const send = async (action, data = {}) => {
  const res = await chrome.runtime.sendMessage({ action, ...data });
  if (!res?.ok) throw new Error(res?.error || "실패했습니다");
  return res;
};

const win = await chrome.windows.getCurrent();
const KEY = `chat:${win.id}`;
let chat = (await chrome.storage.session.get(KEY))[KEY] || { sessionId: null, items: [] };
let running = null; // 진행 중인 chatId
let currentText = null; // 지금 받아 쓰는 답 (items 안의 객체)
let sawDelta = false;

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
  $("#dot").className = `dot ${s === "connected" ? (st.claude ? "ok" : "warn") : s === "off" ? "" : s === "not-installed" ? "err" : "warn"}`;
  $("#statusText").textContent =
    { off: "", connecting: "연결 중", connected: st.claude ? "Claude Code 연결됨" : "claude 없음", "not-installed": "설치 필요", waiting: "다시 연결 중" }[s] ?? s;
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
      `PC 에 연결 프로그램을 한 번 등록해야 합니다 (Node.js 22+, Claude Code 필요). PowerShell 에서:<pre>powershell -ExecutionPolicy Bypass -File "&lt;PagePatch 폴더&gt;\\bridge\\install.ps1"</pre>등록한 뒤 `,
      btn("다시 확인", () => send("bridge:retry"))
    );
  } else if (s === "connected" && !st.claude) {
    notice("Claude Code(claude)를 찾지 못했습니다. 설치한 뒤 install.ps1 을 다시 실행하세요.");
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

const persist = () => chrome.storage.session.set({ [KEY]: { sessionId: chat.sessionId, items: chat.items.map(({ el, ...rest }) => rest).slice(-200) } });

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
  persist();
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
  persist();
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

$("#newChat").onclick = () => {
  if (running) port.postMessage({ type: "chat-cancel", chatId: running });
  chat = { sessionId: null, items: [] };
  running = null;
  persist();
  renderAll();
  updateComposer();
  $("#input").focus();
};

$("#openSettings").onclick = () => chrome.runtime.openOptionsPage();

$("#clearPreview").onclick = async () => {
  const tab = await activeTab();
  if (!tab) return;
  await chrome.scripting
    .executeScript({ target: { tabId: tab.id }, func: () => document.getElementById("pagepatch-preview")?.remove() })
    .catch(() => {});
};

// 대화 중에 사이드바를 닫았다 열면 그 대화는 끊긴다 (background 가 취소함)
if (chat.items.some((i) => i.role === "tool" && !i.status)) {
  for (const i of chat.items) if (i.role === "tool" && !i.status) i.status = "err";
  renderAll();
}
$("#input").focus();
