const $ = (s) => document.querySelector(s);
const send = (action, data = {}) => chrome.runtime.sendMessage({ action, ...data });

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let info = await send("popup", { url: tab?.url, tabId: tab?.id });

const noHash = (u) => String(u || "").replace(/#.*$/, "");

const openOptions = (hash = "") => {
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${hash}`) });
  window.close();
};

// 규칙 JS 가 이 페이지에서 실행됐는지 → [설명, 종류(ok|wait|no|err|off)]
function jsStatus(r) {
  if (r.flags.off) return ["규칙 꺼짐", "off"];
  if (r.flags.offJS) return ["JS 꺼짐", "off"];
  if (!info.userScripts) return ["JS 실행 안 됨 · 사용자 스크립트 꺼짐", "err"];
  const run = info.runs.rules[r.id];
  if (run?.status === "ran") return [noHash(run.url) === noHash(tab.url) ? "JS 실행됨" : "JS 실행됨 (이동 전 주소에서)", "ok"];
  if (run?.status === "waiting") return ["JS 대기 중 (페이지 로드 후 실행)", "wait"];
  if (run?.status === "error") return [`JS 오류: ${run.error || ""}`, "err"];
  if (info.runs.spa && !r.flags.spaJS) return ["JS 실행 안 됨 · SPA 이동 (새로고침하거나 'SPA 이동 시 다시 실행' 켜기)", "no"];
  return ["JS 실행 안 됨 (새로고침 필요)", "no"];
}

// CSS 는 규칙이 켜져 있고 넣는 데 오류가 없으면 적용됨 (맞는 탭에 바로 넣는다)
function cssStatus(r) {
  if (r.flags.off) return ["규칙 꺼짐", "off"];
  if (r.flags.offCSS) return ["CSS 꺼짐", "off"];
  if (info.errors[r.id]) return ["CSS 적용 안 됨", "err"];
  return ["CSS 적용됨", "ok"];
}

// 주석(/* */, //)과 공백을 빼면 남는 게 없는지 (표시용 대략 판단 — 문자열 안의 // 는 어차피 다른 글자가 남는다)
const isBlank = (code) => !code.replace(/\/\*[\s\S]*?(\*\/|$)/g, "").replace(/\/\/.*$/gm, "").trim();

// "JS · CSS" — 적용된 쪽은 초록, 아니면 회색 (비었거나 주석뿐이어도 회색). 자세한 상태는 마우스를 올리면
function codeKinds(r) {
  const el = document.createElement("small");
  el.className = "kinds";
  for (const [k, code, status] of [["JS", r.js, jsStatus], ["CSS", r.css, cssStatus]]) {
    const [desc, kind] = isBlank(code) ? [code.trim() ? `${k} 주석뿐` : `${k} 비어 있음`, "empty"] : status(r);
    if (el.childNodes.length) el.append(" · ");
    const s = document.createElement("span");
    s.className = kind === "ok" ? "on" : "";
    s.textContent = k;
    s.title = desc;
    el.append(s);
  }
  return el;
}

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
    txt.append(b, codeKinds(r));
    // JS 실행 오류는 따로 한 줄 (적용 오류는 아래 info.errors 줄, 사용자 스크립트 꺼짐은 위 안내)
    const run = info.runs.rules[r.id];
    if (r.js.trim() && !r.flags.off && !r.flags.offJS && run?.status === "error") {
      const st = document.createElement("small");
      st.className = "st err";
      st.textContent = `JS 오류: ${run.error || ""}`;
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

// 복사 제한 해제 (http·https 페이지만). 켜면 바로 적용, 끄면 새로고침해야 반영
function renderUnlock() {
  $("#unlock").hidden = !info.unlock;
  if (!info.unlock) return;
  $("#uCopy").checked = info.unlock.copy;
  $("#uStrong").checked = info.unlock.strong;
}
for (const [id, mode] of [["#uCopy", "copy"], ["#uStrong", "strong"]]) {
  $(id).onchange = async (e) => {
    const value = e.target.checked;
    const res = await send("unlock:set", { host: info.unlock.host, mode, value, tabId: tab.id });
    // 저장이 안 됐으면 체크를 되돌리고 이유를 보여 준다 (조용히 실패하지 않게)
    if (!res?.ok) {
      e.target.checked = !value;
      $("#uMsg").textContent = res?.error || "저장하지 못했습니다";
      $("#uMsg").hidden = false;
      return;
    }
    $("#uMsg").hidden = true;
    info.unlock[mode] = value;
    if (!value) $("#uReload").hidden = false;
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
