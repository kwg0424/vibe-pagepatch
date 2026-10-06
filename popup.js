const $ = (s) => document.querySelector(s);
const send = (action, data = {}) => chrome.runtime.sendMessage({ action, ...data });

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let info = await send("popup", { url: tab?.url, tabId: tab?.id });

const noHash = (u) => String(u || "").replace(/#.*$/, "");

const openOptions = (hash = "") => {
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${hash}`) });
  window.close();
};

// 규칙 JS 가 이 페이지에서 실행됐는지 → [글자, 종류(ok|wait|no|err)]
function jsStatus(r) {
  if (!r.js.trim() || r.flags.off || r.flags.offJS) return null;
  if (!info.userScripts) return ["JS 실행 안 됨 · 사용자 스크립트 꺼짐", "err"];
  const run = info.runs.rules[r.id];
  if (run?.status === "ran") return [noHash(run.url) === noHash(tab.url) ? "JS 실행됨" : "JS 실행됨 (이동 전 주소에서)", "ok"];
  if (run?.status === "waiting") return ["JS 대기 중 (페이지 로드 후 실행)", "wait"];
  if (run?.status === "error") return [`JS 오류: ${run.error || ""}`, "err"];
  if (info.runs.spa && !r.flags.spaJS) return ["JS 실행 안 됨 · SPA 이동 (새로고침하거나 'SPA 이동 시 다시 실행' 켜기)", "no"];
  return ["JS 실행 안 됨 (새로고침 필요)", "no"];
}

// "CSS · JS" (따로 꺼 둔 쪽은 "JS 꺼짐")
const codeKinds = (r, sep) =>
  [r.css.trim() && (r.flags.offCSS ? "CSS 꺼짐" : "CSS"), r.js.trim() && (r.flags.offJS ? "JS 꺼짐" : "JS")].filter(Boolean).join(sep);

function render() {
  const list = $("#list");
  list.replaceChildren();
  $("#empty").hidden = info.rules.length > 0;
  for (const r of info.rules) {
    // 이름 쪽을 누르면 편집, 오른쪽 체크박스로 켜고 끔
    const row = document.createElement("div");
    row.className = "row";
    row.classList.toggle("off", r.flags.off);
    row.title = `${r.urls}\n누르면 편집`;
    row.onclick = (e) => {
      if (e.target !== box) openOptions(`#rule=${encodeURIComponent(r.id)}`);
    };

    const txt = document.createElement("span");
    txt.className = "txt";
    const b = document.createElement("b");
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = r.name || r.urls;
    b.append(nm);
    const kinds = document.createElement("small");
    kinds.textContent = codeKinds(r, " · ") || "비어 있음";
    txt.append(b, kinds);
    const status = jsStatus(r);
    if (status) {
      const st = document.createElement("small");
      st.className = `st ${status[1]}`;
      st.textContent = status[0];
      txt.append(st);
    }
    if (info.errors[r.id]) {
      const err = document.createElement("small");
      err.className = "err";
      err.textContent = info.errors[r.id];
      txt.append(err);
    }

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !r.flags.off;
    box.title = "규칙 켜기/끄기";
    box.onchange = async () => {
      r.flags.off = !box.checked;
      row.classList.toggle("off", r.flags.off);
      await send("rule:toggle", { id: r.id, off: r.flags.off });
    };
    row.append(txt, box);
    list.append(row);
  }
}

// 우클릭·복사 허용 (http·https 페이지만). 켜면 바로 적용, 끄면 새로고침해야 반영
function renderUnlock() {
  $("#unlock").hidden = !info.unlock;
  if (!info.unlock) return;
  $("#uCopy").checked = info.unlock.copy;
  $("#uStrong").checked = info.unlock.strong;
}
for (const [id, mode] of [["#uCopy", "copy"], ["#uStrong", "strong"]]) {
  $(id).onchange = async (e) => {
    await send("unlock:set", { host: info.unlock.host, mode, value: e.target.checked, tabId: tab.id });
    info.unlock[mode] = e.target.checked;
    if (!e.target.checked) $("#uReload").hidden = false;
  };
}
$("#uReload").onclick = () => {
  chrome.tabs.reload(tab.id);
  window.close();
};

$("#settings").onclick = () => openOptions();
$("#howto").onclick = (e) => {
  e.preventDefault();
  openOptions("#settings");
};
$("#userscripts").hidden = info.userScripts;

if (!info.injectable) {
  $("#unsupported").hidden = false;
  $("#main").hidden = true;
} else {
  try {
    $("#host").textContent = new URL(tab.url).host;
    $("#host").hidden = false;
  } catch {}
  renderUnlock();
  render();
}

// 실행 상태가 바뀌면 (onload 뒤 실행, SPA 이동) 다시 그린다
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "session" || !changes.runs || !info.injectable) return;
  info = await send("popup", { url: tab.url, tabId: tab.id });
  renderUnlock();
  render();
  renderClaude();
});

$("#new").onclick = () => openOptions(`#new=${encodeURIComponent(tab.url)}`);

// Claude 와 고치기: 이 페이지에 규칙이 있고 Claude Code 가 연결돼 있을 때만
function renderClaude() {
  const connected = info.bridgeStatus?.state === "connected" && !!info.bridgeStatus?.claude;
  $("#claude").hidden = !connected || !info.rules.length;
}
renderClaude();
$("#claude").onclick = async () => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (e) {
    alert(`사이드바를 열 수 없습니다: ${e.message}`);
  }
  window.close();
};
