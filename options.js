// 설정 화면: 규칙 목록·편집기(Ace) / 설정(사용자 스크립트, Claude Code, 동기화, 표시, 데이터).
// 저장은 모두 background 에 부탁한다 (쓰기는 한 곳에서).
import { parseUrls } from "./src/urls.js";
import { FLAGS, NEW_RULE_FLAGS, normalizeUrl } from "./src/model.js";
import { variants } from "./src/jump.js";
import { renderMarkdown } from "./src/markdown.js";
import { setupCommand } from "./src/bridgesetup.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const send = async (action, data = {}) => {
  const res = await chrome.runtime.sendMessage({ action, ...data });
  if (!res?.ok) throw new Error(res?.error || "실패했습니다");
  return res;
};

let data = null; // background 의 state
let current = null; // { id|null, original: 규칙(새 규칙이면 빈 값) }
let loadingForm = false;

// ── 공통 ──

function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

function ago(t) {
  if (!t) return "";
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return new Date(t).toLocaleString();
}

function showView(view) {
  for (const b of $$(".tab")) b.classList.toggle("active", b.dataset.view === view);
  $("#rules").hidden = view !== "rules";
  $("#jump").hidden = view !== "jump";
  $("#unlock").hidden = view !== "unlock";
  $("#settings").hidden = view !== "settings";
  if (view === "rules") editor.resize();
}
// 규칙 탭은 편집 중이던 규칙 주소로, 나머지는 #탭이름
for (const b of $$(".tab")) b.onclick = () => (location.hash = b.dataset.view === "rules" ? (current?.id ? `rule=${current.id}` : "") : b.dataset.view);
for (const b of $$("[data-goto]")) b.onclick = () => (location.hash = b.dataset.goto);

// ── 편집기 ──

ace.config.set("basePath", "vendor/ace");
const dark = matchMedia("(prefers-color-scheme: dark)");
const theme = () => (dark.matches ? "ace/theme/one_dark" : "ace/theme/chrome");
// CSS · JS 편집기 두 개를 나란히
const editors = {};
const sessions = {};
for (const [kind, el, mode] of [["css", "aceCss", "ace/mode/css"], ["js", "aceJs", "ace/mode/javascript"]]) {
  const ed = ace.edit(el, {
    theme: theme(),
    mode,
    fontSize: 13.5,
    showPrintMargin: false,
    enableBasicAutocompletion: true,
    enableLiveAutocompletion: true,
    enableSnippets: false,
    scrollPastEnd: 0.3,
    useWorker: false,
    tabSize: 2,
    useSoftTabs: true,
  });
  ed.commands.addCommand({ name: "save", bindKey: { win: "Ctrl-S", mac: "Command-S" }, exec: () => save() });
  ed.session.on("change", () => !loadingForm && onEdit());
  editors[kind] = ed;
  sessions[kind] = ed.session;
}
// AI 규칙(notes) 편집기: 마크다운이라 줄바꿈해서 보여 주고 자동완성은 끈다
{
  const ed = ace.edit("aceNotes", { theme: theme(), mode: "ace/mode/text", fontSize: 13.5, showPrintMargin: false, wrap: true, scrollPastEnd: 0.3, useWorker: false, tabSize: 2, useSoftTabs: true });
  ed.commands.addCommand({ name: "save", bindKey: { win: "Ctrl-S", mac: "Command-S" }, exec: () => save() });
  ed.session.on("change", () => !loadingForm && onEdit());
  editors.notes = ed;
  sessions.notes = ed.session;
}
dark.addEventListener("change", () => Object.values(editors).forEach((ed) => ed.setTheme(theme())));
const editor = { resize: () => Object.values(editors).forEach((ed) => ed.resize()) };

const HINTS = {
  css: "Ctrl+S 저장 · Ctrl+F 찾기 · 페이지 스타일을 이기려면 !important (또는 '자동 !important')",
  get js() {
    const claude = data?.bridge?.enabled && data?.bridgeStatus?.state === "connected";
    return `저장 후 새로고침해야 실행됩니다 · PagePatch.onLeave(fn): SPA 로 떠날 때 되돌리기${claude ? " · PagePatch.log(...): Claude 가 보는 기록" : ""}`;
  },
};

function renderHints() {
  $("#cssHint").textContent = HINTS.css;
  $("#codeHint").textContent = HINTS.js;
}

const emptyRule = (urls = "") => ({ id: null, name: "", urls, js: "", css: "", notes: "", flags: Object.fromEntries(FLAGS.map((k) => [k, !!NEW_RULE_FLAGS[k]])) });

function readForm() {
  const flags = {};
  for (const box of $$("[data-flag]")) flags[box.dataset.flag] = box.checked;
  for (const box of $$("[data-flag-on]")) flags[box.dataset.flagOn] = !box.checked; // JS · CSS 제목 옆: 체크 = 켜짐 (flag 는 offJS · offCSS)
  flags.off = !!current?.original?.flags.off; // 활성화는 왼쪽 목록에서
  flags.atStartJS = $("#fTiming").value === "start";
  flags.onLoadJS = $("#fTiming").value === "load";
  return { name: $("#fName").value.trim(), urls: $("#fUrls").value.trim(), css: sessions.css.getValue(), js: sessions.js.getValue(), notes: sessions.notes.getValue(), flags };
}

function isDirty() {
  if (!current) return false;
  const f = readForm();
  const o = current.original;
  return f.name !== o.name || f.urls !== o.urls || f.css !== o.css || f.js !== o.js || f.notes !== (o.notes || "") || FLAGS.some((k) => !!f.flags[k] !== !!o.flags[k]);
}

function onEdit() {
  const dirty = isDirty();
  $("#dirtyMark").textContent = dirty ? "저장 안 됨" : current?.id ? "" : "새 규칙";
  $("#save").disabled = !dirty && !!current?.id;
  $("#cancel").disabled = !dirty;
  updateCounts();
  updateUrlInfo();
  renderNotes();
  // 꺼 둔 쪽은 옵션·편집기를 흐리게 (편집은 그대로 됨)
  for (const box of $$("[data-flag-on]")) box.closest(".code").classList.toggle("disabled", !box.checked);
}

// AI 규칙: 'AI 규칙' 버튼으로 아래 영역을 JS · CSS ↔ AI 규칙(왼쪽 편집, 오른쪽 미리보기) 전환. 규칙을 바꿔도 보던 쪽 유지
let aiMode = false;
function setAiMode(on) {
  aiMode = on;
  $("#codePane").hidden = on;
  $("#notesPane").hidden = !on;
  $("#aiBtn").classList.toggle("active", on);
  editor.resize();
  if (on) editors.notes.focus();
}
$("#aiBtn").onclick = () => setAiMode(!aiMode);

const NOTES_PLACEHOLDER = `<p class="muted">아직 없습니다. 왼쪽에 이렇게 적어 두면 됩니다:</p><pre><code>## 목적
본문을 넓고 가운데로 정렬

## 바꿀 것
- 본문 폭 1920px 혹은 1280px
- 이미지나 영상은 가로폭 100% 채울 것, 세로는 비율에 맞게 증가
- 글자에서 오는 이모지 같은 글은 깨질 수 있으니 폰트 변경 금지</code></pre>`;

function renderNotes() {
  const md = sessions.notes.getValue();
  $("#notesView").innerHTML = md.trim() ? renderMarkdown(md) : NOTES_PLACEHOLDER; // renderMarkdown 은 모든 글자를 이스케이프한다
  $("#notesCount").textContent = md.trim() ? `${md.split("\n").length}줄` : "";
  $("#aiBtn").classList.toggle("has-notes", !!md.trim());
}

function updateCounts() {
  const n = (s) => (s.trim() ? `${s.split("\n").length}줄` : "");
  $("#cssCount").textContent = n(sessions.css.getValue());
  $("#jsCount").textContent = n(sessions.js.getValue());
}

function updateUrlInfo() {
  const { urls, flags } = readForm();
  const el = $("#urlInfo");
  if (!urls) {
    el.textContent = "주소 패턴을 입력하세요";
    return;
  }
  const { matches, excludeMatches, regex, excludeRegex, invalid } = parseUrls(urls, flags.strictUrl);
  const rx = (list) => list.map((x) => `/${x.source}/${x.flags}`);
  const parts = [];
  if (matches.length || regex.length) parts.push(`적용: ${[...matches, ...rx(regex)].join(", ")}`);
  if (excludeMatches.length || excludeRegex.length) parts.push(`제외: ${[...excludeMatches, ...rx(excludeRegex)].join(", ")}`);
  el.textContent = parts.join("   ·   ");
  if (invalid.length) {
    const bad = document.createElement("span");
    bad.className = "bad";
    bad.textContent = `${parts.length ? "   ·   " : ""}잘못된 패턴: ${invalid.join(", ")}`;
    el.append(bad);
  }
}

function fillForm(rule) {
  loadingForm = true;
  $("#fName").value = rule.name;
  $("#fUrls").value = rule.urls;
  for (const box of $$("[data-flag]")) box.checked = !!rule.flags[box.dataset.flag];
  for (const box of $$("[data-flag-on]")) box.checked = !rule.flags[box.dataset.flagOn];
  $("#fTiming").value = rule.flags.atStartJS ? "start" : rule.flags.onLoadJS ? "load" : "end";
  sessions.css.setValue(rule.css);
  sessions.js.setValue(rule.js);
  sessions.notes.setValue(rule.notes || "");
  loadingForm = false;
  $("#changedNotice").hidden = true;
  const err = rule.id && data.errors[rule.id];
  $("#ruleError").textContent = err || "";
  $("#ruleError").hidden = !err;
  $("#delete").disabled = !rule.id;
  $("#historyBtn").disabled = !rule.id;
  onEdit();
}

function openRule(rule) {
  current = { id: rule.id, original: structuredClone(rule) };
  if (rule.name.trim()) openFolder = rule.name.trim(); // 편집하는 규칙이 든 폴더만 연다 (다른 폴더는 닫힘)
  $("#placeholder").hidden = true;
  $("#form").hidden = false;
  fillForm(rule);
  renderHints();
  $("#history").hidden = true;
  renderList();
  editor.resize();
}

function confirmLeave() {
  return !isDirty() || confirm("저장하지 않은 변경이 있습니다. 버릴까요?");
}

for (const el of [$("#fName"), $("#fUrls")]) el.addEventListener("input", onEdit);
for (const el of [$("#fTiming"), ...$$("[data-flag]"), ...$$("[data-flag-on]")]) el.addEventListener("change", onEdit);
window.addEventListener("beforeunload", (e) => {
  if (isDirty()) e.preventDefault();
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !$("#rules").hidden) {
    e.preventDefault();
    save();
  }
});

// 저장 중에는 storage.onChanged 가 내 저장을 "다른 곳에서 바뀜"으로 보지 않게 (응답 전엔 current.original 이 저장 전 값)
let saving = false;

async function save() {
  if (!current) return;
  const f = readForm();
  if (!f.urls) {
    toast("주소 패턴을 입력하세요");
    $("#fUrls").focus();
    return;
  }
  saving = true;
  try {
    const res = await send("rule:save", { rule: { ...(current.id ? { id: current.id } : {}), ...f } });
    current = { id: res.rule.id, original: structuredClone(res.rule) };
    await reload();
    fillForm(res.rule);
    history.replaceState(null, "", `#rule=${res.rule.id}`);
    toast(res.error ? "저장했지만 적용에 문제가 있습니다" : "저장했습니다");
  } catch (e) {
    toast(e.message);
  } finally {
    saving = false;
  }
}
$("#save").onclick = save;

$("#cancel").onclick = () => {
  if (current) fillForm(current.original);
};

$("#delete").onclick = async () => {
  if (!current?.id || !confirm(`"${current.original.name || current.original.urls}" 규칙을 삭제할까요?`)) return;
  await send("rule:delete", { id: current.id });
  current = null;
  $("#form").hidden = true;
  $("#placeholder").hidden = false;
  history.replaceState(null, "", "#");
  await reload();
  toast("삭제했습니다");
};

$("#newRule").onclick = () => {
  if (!confirmLeave()) return;
  history.replaceState(null, "", "#");
  openRule(emptyRule());
  $("#fName").focus();
};

$("#reloadRule").onclick = () => {
  const r = data.rules.find((x) => x.id === current?.id);
  if (r) openRule(r);
};

// ── 변경 기록 ──

const BY = { user: "직접", claude: "Claude", sync: "동기화", import: "가져오기", revert: "되돌리기" };

$("#historyBtn").onclick = async () => {
  if (!current?.id) return;
  const { versions } = await send("rule:history", { id: current.id });
  const ul = $("#versions");
  ul.replaceChildren();
  versions.forEach((v, i) => {
    const li = document.createElement("li");
    const head = document.createElement("div");
    head.textContent = `${i === 0 ? "지금 · " : ""}${new Date(v.t).toLocaleString()}`;
    const by = document.createElement("span");
    by.className = `by ${v.by}`;
    by.textContent = BY[v.by] || v.by;
    head.append(by);
    const meta = document.createElement("div");
    meta.className = "muted small";
    meta.textContent = `CSS ${v.css.length}자 · JS ${v.js.length}자${v.flags.off ? " · 꺼짐" : ""}`;
    li.append(head, meta);
    li.onclick = () => {
      fillForm({ ...current.original, name: v.name, urls: v.urls, css: v.css, js: v.js, notes: v.notes || "", flags: v.flags });
      toast("이 버전을 불러왔습니다. 저장하면 반영됩니다");
    };
    ul.append(li);
  });
  if (!versions.length) ul.innerHTML = `<li class="muted">기록이 없습니다</li>`;
  $("#history").hidden = false;
  editor.resize();
};
$("#closeHistory").onclick = () => {
  $("#history").hidden = true;
  editor.resize();
};

// ── 목록 ──

// 이름이 같은 규칙은 폴더로 묶는다. 처음엔 모두 닫힘, 한 번에 하나만 열린다 (다른 폴더를 열면 열린 폴더는 닫힘)
let openFolder = null; // 열린 폴더 이름
localStorage.removeItem("openFolders"); // 예전(여러 개 열기) 기억 지우기

function renderList() {
  const q = $("#search").value.trim().toLowerCase();
  const ul = $("#ruleList");
  ul.replaceChildren();
  const list = data.rules.filter((r) => !q || [r.name, r.urls, r.css, r.js, r.notes || ""].some((s) => s.toLowerCase().includes(q)));
  $("#noRules").hidden = data.rules.length > 0;
  const groups = new Map(); // 이름 → 규칙들 (처음 나온 순서)
  for (const r of list) {
    const key = r.name.trim() || `\0${r.id}`; // 이름 없는 규칙은 묶지 않는다
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const [name, rules] of groups) {
    if (rules.length === 1) {
      ul.append(ruleItem(rules[0]));
      continue;
    }
    // 검색 중이면 모두 펼친다 (편집할 규칙을 열 때 그 폴더가 openFolder 가 된다 → openRule)
    const open = !!q || openFolder === name;
    const folder = document.createElement("li");
    folder.className = "folder";
    folder.classList.toggle("open", open);
    const head = document.createElement("div");
    head.className = "folder-head";
    head.classList.toggle("off", rules.every((r) => r.flags.off));
    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.textContent = open ? "▾" : "▸";
    // 단일 규칙과 같은 두 줄 (이름 / 규칙 개수) → 높이가 같다
    const txt = document.createElement("div");
    txt.className = "txt";
    const nm = document.createElement("div");
    nm.className = "nm";
    nm.textContent = name;
    const count = document.createElement("div");
    count.className = "ur";
    count.textContent = `규칙 ${rules.length}개`;
    txt.append(nm, count);
    head.append(arrow, txt);
    if (rules.some((r) => data.errors[r.id])) {
      const dot = document.createElement("span");
      dot.className = "dot err";
      dot.title = "오류가 있는 규칙이 있습니다";
      head.append(dot);
    }
    folder.build = () => {
      const sub = document.createElement("ul");
      for (const r of rules) sub.append(ruleItem(r, true));
      return sub;
    };
    // 다시 그리지 않고 이 폴더만 펼치고, 열려 있던 다른 폴더는 접는다 (애니메이션)
    head.onclick = () => {
      openFolder = openFolder === name ? null : name;
      for (const f of ul.querySelectorAll(".folder.open")) if (f !== folder) setFolderOpen(f, false);
      setFolderOpen(folder, openFolder === name);
    };
    folder.append(head);
    if (open) folder.append(folder.build());
    ul.append(folder);
  }
}

// 폴더 펼치기·접기 애니메이션 시간(ms, EdgeMark 기본값과 같게). 0 이면 바로
const FOLDER_MS = 100;

// 하위 목록 높이를 0 ↔ 실제 높이로 (EdgeMark 와 같은 방식). 끝나면 이루어지고, 중간에 멈추면(cancel) 거부되는 Promise
function slide(box, opening) {
  for (const a of box.getAnimations()) a.cancel();
  const h = box.scrollHeight;
  if (!FOLDER_MS || !h) return Promise.resolve();
  const frames = [{ height: "0px", opacity: 0, overflow: "hidden" }, { height: `${h}px`, opacity: 1, overflow: "hidden" }];
  if (!opening) frames.reverse();
  return box.animate(frames, { duration: FOLDER_MS, easing: "ease-out" }).finished;
}

function setFolderOpen(folder, open) {
  if (folder.classList.contains("open") === open) return;
  folder.classList.toggle("open", open);
  folder.querySelector(".arrow").textContent = open ? "▾" : "▸";
  let sub = folder.querySelector(":scope > ul");
  if (open) {
    if (!sub) folder.append((sub = folder.build()));
    slide(sub, true).catch(() => {});
  } else if (sub) {
    // 접기: 애니메이션이 끝나면 하위 목록을 뺀다 (그 사이 다시 펼쳤으면 그대로)
    slide(sub, false).then(() => !folder.classList.contains("open") && sub.remove(), () => {});
  }
}

// inFolder: 폴더 안에서는 이름 대신 주소만 보여 준다
function ruleItem(r, inFolder = false) {
  const li = document.createElement("li");
  li.className = "rule";
  li.classList.toggle("active", r.id === current?.id);
  li.classList.toggle("off", r.flags.off);
  // 활성화 체크박스 (목록에서 바로 켜고 끔)
  const on = document.createElement("input");
  on.type = "checkbox";
  on.checked = !r.flags.off;
  on.title = r.flags.off ? "비활성 · 누르면 활성화" : "활성 · 누르면 비활성화";
  on.onclick = (e) => e.stopPropagation();
  on.onchange = async () => {
    const off = !on.checked;
    if (r.id === current?.id) current.original.flags.off = off; // 편집 중인 규칙이면 '다른 곳에서 바뀜' 알림이 뜨지 않게
    r.flags.off = off;
    li.classList.toggle("off", off);
    await send("rule:toggle", { id: r.id, off });
  };
  li.append(on);
  const txt = document.createElement("div");
  txt.className = "txt";
  if (!inFolder) {
    const nm = document.createElement("div");
    nm.className = "nm";
    nm.textContent = r.name || "-";
    nm.classList.toggle("empty", !r.name);
    txt.append(nm);
  }
  const ur = document.createElement("div");
  ur.className = "ur";
  ur.textContent = r.urls;
  txt.append(ur);
  if (data.errors[r.id]) {
    const dot = document.createElement("span");
    dot.className = "dot err";
    dot.title = data.errors[r.id];
    li.append(dot);
  }
  li.append(txt);
  li.onclick = () => {
    if (r.id === current?.id || !confirmLeave()) return;
    location.hash = `rule=${r.id}`;
  };
  return li;
}
$("#search").addEventListener("input", renderList);

// ── 복사 제한 해제 (사이트 목록) ──

function uMessage(text, isError) {
  const m = $("#uMessage");
  m.textContent = text || "";
  m.classList.toggle("error", !!isError);
  m.hidden = !text;
}

function siteCheckbox(host, mode) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!data.settings.sites[host][mode];
  input.setAttribute("aria-label", `${host} ${mode === "copy" ? "복사 제한 해제" : "강력 해제"}`);
  input.onchange = async () => {
    const res = await send("unlock:set", { host, mode, value: input.checked });
    data.settings.sites = res.sites;
    if (!res.sites[host]) renderSites(); // 둘 다 끄면 목록에서 빠짐
  };
  return input;
}

function renderSites() {
  const sites = data.settings.sites;
  const q = $("#uFilter").value.trim().toLowerCase();
  const hosts = Object.keys(sites).sort();
  const shown = hosts.filter((h) => h.includes(q));
  const rows = shown.map((host) => {
    const tr = document.createElement("tr");
    const tdHost = document.createElement("td");
    tdHost.className = "col-host";
    tdHost.textContent = tdHost.title = host;
    const [tdCopy, tdStrong] = ["copy", "strong"].map((mode) => {
      const td = document.createElement("td");
      td.className = "col-check";
      td.append(siteCheckbox(host, mode));
      return td;
    });
    const tdDel = document.createElement("td");
    tdDel.className = "col-del";
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "삭제";
    del.onclick = async () => {
      if (!confirm(`${host} 을(를) 목록에서 삭제할까요?`)) return;
      data.settings.sites = (await send("unlock:remove", { host })).sites;
      renderSites();
    };
    tdDel.append(del);
    tr.append(tdHost, tdCopy, tdStrong, tdDel);
    return tr;
  });
  $("#uRows").replaceChildren(...rows);
  $("#uCount").textContent = q ? `${shown.length} / ${hosts.length}개` : `${hosts.length}개`;
  $("#uEmpty").hidden = hosts.length > 0;
}

$("#uAddForm").onsubmit = async (e) => {
  e.preventDefault();
  const value = $("#uAddInput").value;
  if (!value.trim()) return;
  try {
    const res = await send("unlock:add", { host: value });
    data.settings.sites = res.sites;
    uMessage(`${res.host} 을(를) 추가했습니다. (우클릭 · 복사 켜짐)`);
    $("#uAddInput").value = "";
    $("#uFilter").value = "";
  } catch (err) {
    uMessage(err.message, true);
  }
  renderSites();
};
$("#uFilter").addEventListener("input", renderSites);

// ── 검색 이동 (StayTab 의 주소창 키워드) ──
// 저장은 키워드마다 (키워드 → 주소). 화면에서는 주소별로 묶어 보여 주고, 주소 하나에 키워드를 쉼표로 여러 개 넣는다.
// 키워드는 background 가 띄어쓰기를 지워 저장한다 ("구글 지도" → "구글지도")

let jEditing = null; // 행을 눌러 고치는 중인 주소

function jMessage(text, isError) {
  const m = $("#jMessage");
  m.textContent = text || "";
  m.classList.toggle("error", !!isError);
  m.hidden = !text;
}

// [[주소, [키워드…]]], 주소 순
function jumpGroups() {
  const by = {};
  for (const j of data.jumps) (by[j.url] ||= []).push(j.id);
  return Object.entries(by)
    .map(([url, list]) => [url, list.sort((a, b) => a.localeCompare(b, "ko"))])
    .sort(([a], [b]) => a.localeCompare(b));
}

function setJumpEditing(url, keywords) {
  jEditing = url;
  $("#jUrl").value = url || "";
  $("#jKeywords").value = keywords ? keywords.join(", ") : "";
  $("#jSubmit").textContent = url ? "저장" : "추가";
  $("#jCancel").hidden = !url;
  renderJumps();
}

function renderJumps() {
  const groups = jumpGroups();
  const rows = groups.map(([url, keywords]) => {
    const tr = document.createElement("tr");
    tr.title = "눌러서 수정";
    tr.classList.toggle("editing", url === jEditing);
    tr.onclick = () => {
      setJumpEditing(url, keywords);
      $("#jKeywords").focus();
    };
    const tdUrl = document.createElement("td");
    tdUrl.textContent = url;
    const tdKw = document.createElement("td");
    tdKw.className = "col-kw";
    // 등록한 키워드, 그 뒤에 한/영 전환 없이 친 모양을 회색으로 (지도, wleh)
    const auto = [...new Set(keywords.flatMap(variants))].filter((v) => !keywords.includes(v));
    tdKw.textContent = keywords.join(", ");
    if (auto.length) {
      const span = document.createElement("span");
      span.className = "auto";
      span.title = "한/영 전환 없이 쳐도 됨 (자동)";
      span.textContent = `, ${auto.join(", ")}`;
      tdKw.append(span);
    }
    const tdDel = document.createElement("td");
    tdDel.className = "col-del";
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "삭제";
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`${url}\n키워드 ${keywords.join(", ")} 를 삭제할까요?`)) return;
      data.jumps = (await send("jump:delete", { url })).jumps;
      if (url === jEditing) setJumpEditing(null);
      else renderJumps();
    };
    tdDel.append(del);
    tr.append(tdUrl, tdKw, tdDel);
    return tr;
  });
  $("#jRows").replaceChildren(...rows);
  $("#jEmpty").hidden = groups.length > 0;
}

$("#jForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const res = await send("jump:save", { url: $("#jUrl").value, keywords: $("#jKeywords").value, oldUrl: jEditing });
    data.jumps = res.jumps;
    jMessage(`${jEditing ? "저장했습니다" : "추가했습니다"}${res.moved.length ? ` (${res.moved.join(", ")} 는 다른 주소에서 옮겨 옴)` : ""}`);
    setJumpEditing(null);
    $("#jUrl").focus();
  } catch (err) {
    jMessage(err.message, true);
  }
};
$("#jCancel").onclick = () => {
  jMessage("");
  setJumpEditing(null);
};

// ── 브라우저 (StayTab 의 기본 설정) ──
// 백그라운드 상주 = 선택 권한 "background" (이 PC에만). 체크박스는 권한이 있는지 그대로 보여 준다.
// 권한 요청은 클릭(사용자 동작) 안에서 바로 해야 한다. 경고 없는 권한이라 확인 창 없이 허용된다
const BG = { permissions: ["background"] };

function browserMessage(text, isError) {
  const m = $("#browserMessage");
  m.textContent = text || "";
  m.classList.toggle("error", !!isError);
  m.hidden = !text;
}

// 탭 복원은 상주 중에만 동작하므로 상주가 꺼져 있으면 흐리게
function showKeepAlive(on) {
  $("#keepAlive").checked = on;
  $("#restore").disabled = !on;
  $("#rowRestore").classList.toggle("off", !on);
}

$("#keepAlive").onchange = async (e) => {
  const on = e.target.checked;
  const ok = on ? await chrome.permissions.request(BG) : await chrome.permissions.remove(BG);
  showKeepAlive(ok ? on : !on);
};

function renderBrowser() {
  $("#restore").checked = data.settings.restore;
  $("#newtabOn").checked = data.settings.newtab.on;
  if (document.activeElement !== $("#newtabUrl")) $("#newtabUrl").value = data.settings.newtab.url;
}

$("#restore").onchange = (e) => send("settings", { patch: { restore: e.target.checked } });

$("#newtabOn").onchange = async (e) => {
  const on = e.target.checked;
  if (on && !normalizeUrl($("#newtabUrl").value)) {
    browserMessage("먼저 주소를 입력하세요", true);
    $("#newtabUrl").focus();
  } else browserMessage("");
  await send("settings", { patch: { newtab: { ...data.settings.newtab, on } } });
};

$("#newtabForm").onsubmit = async (e) => {
  e.preventDefault();
  const raw = $("#newtabUrl").value.trim();
  const url = raw ? normalizeUrl(raw) : "";
  if (url === null) return browserMessage("올바른 주소가 아닙니다", true);
  $("#newtabUrl").value = url;
  // 주소를 넣으면 새 탭 주소도 켠다, 지우면 끈다
  await send("settings", { patch: { newtab: { on: !!url, url } } });
  browserMessage(url ? "저장했습니다. 새 탭이 이 주소로 열립니다" : "주소를 지워 새 탭 주소를 껐습니다");
};

chrome.permissions.contains(BG).then(showKeepAlive); // 첫 화면을 기다리게 하지 않는다

// ── 설정 ──

const timeText = (t) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function setDesc(el, text, kind = "") {
  el.textContent = text || "";
  el.className = `desc ${kind}`;
  el.hidden = !text;
}

function message(text, isError) {
  const m = $("#storage-message");
  m.textContent = text || "";
  m.classList.toggle("error", !!isError);
  m.hidden = !text;
}

// Claude Code
const BRIDGE_SETUP = setupCommand(chrome.runtime.id); // 확장 안의 bridge 파일로 등록 (src/bridgesetup.js)
const BRIDGE_STATE = {
  connecting: ["연결하는 중…", ""],
  connected: ["연결됨", "ok"],
  "not-installed": ["이 PC 에 연결 프로그램이 등록되지 않았습니다", "error"],
  waiting: ["연결 프로그램이 응답하지 않습니다. 잠시 뒤 다시 시도합니다", "error"],
};

function renderBridge() {
  const st = data.bridgeStatus || { state: "off" };
  $("#bEnabled").checked = data.bridge.enabled;
  $("#bEval").checked = data.bridge.allowEval;
  const on = data.bridge.enabled && st.state !== "off";
  let [text, kind] = on ? BRIDGE_STATE[st.state] || [st.state, ""] : ["", ""];
  if (on && st.state === "connected") {
    if (st.claude) text += ` · ${st.claude}`;
    else [text, kind] = ["연결됐지만 Claude Code(claude)를 찾지 못했습니다. 설치한 뒤 연결 프로그램 설치 명령을 다시 실행하세요", "error"];
  }
  setDesc($("#bState"), text, kind);
  const outdated = on && st.state === "connected" && st.outdated;
  $("#bInstallWhy").textContent = outdated ? "연결 프로그램이 예전 버전입니다. 같은 명령으로 다시 등록하세요" : "처음 한 번 이 PC 에 연결 프로그램을 등록해야 합니다";
  $("#bInstall").hidden = !(on && (st.state === "not-installed" || outdated));
  $("#bRetryWrap").hidden = !on || st.state === "connected" || st.state === "connecting";
  $("#bEvalRow").hidden = !(on && st.state === "connected");
  renderHints();
}

// 동기화 (EdgeMark · StayTab 과 같은 화면)
let connectOpen = false;
let busy = false;
let lastRunEnd = 0;

function renderStorage() {
  const s = data.sync;
  const server = s.mode === "server";
  $("#sub").textContent = server ? "서버(WebDAV) 동기화로 다른 PC와 규칙을 공유합니다." : "브라우저 계정 동기화로 다른 PC와 규칙을 공유합니다.";
  $("#storage-browser").hidden = server || connectOpen;
  $("#storage-server").hidden = !server || connectOpen;
  $("#form-connect").hidden = !connectOpen;
  if (server) {
    $("#server-url").textContent = s.username ? `${s.url} · ${s.username}` : s.url;
    const st = s.server;
    setDesc($("#server-state"), st?.error ? st.error : st?.at ? `마지막 동기화 ${timeText(st.at)}` : "", st?.error ? "error" : "");
  } else {
    const st = s.browser;
    const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
    let text = "";
    if (st?.error) text = st.error;
    else if (st?.at) {
      text = `마지막 동기화 ${timeText(st.at)} · 사용량 ${kb(st.bytes || 0)} / ${kb(data.syncLimits.quota)}`;
      if ((st.bytes || 0) > data.syncLimits.warn) text += " · 용량이 거의 찼습니다. 서버(WebDAV) 동기화를 쓰세요";
    }
    setDesc($("#browser-state"), text, st?.error ? "error" : "");
  }
  for (const b of $$("#storage button")) b.disabled = busy;
}

const DONE = {
  created: "서버에 새 규칙 파일을 만들었습니다",
  pushed: "저장했습니다",
  merged: "양쪽 변경을 합쳐 저장했습니다",
  pulled: "규칙을 가져왔습니다",
  unchanged: "이미 최신 상태입니다",
};

async function run(action, payload = {}) {
  busy = true;
  renderStorage();
  message("");
  try {
    const res = await chrome.runtime.sendMessage({ action, ...payload });
    if (!res?.ok) message(res?.error || "실패했습니다", true);
    else if (DONE[res.action]) message(DONE[res.action]);
    return res || {};
  } finally {
    busy = false;
    lastRunEnd = Date.now();
    await reload();
  }
}

function openConnect() {
  const f = $("#form-connect").elements;
  const server = data.sync.mode === "server";
  f.url.value = server ? data.sync.url : "";
  f.username.value = server ? data.sync.username : "";
  f.password.value = ""; // 저장된 비밀번호는 표시하지 않는다. 비워 두면 그대로 쓴다
  f.password.required = !(server && data.sync.hasPassword);
  f.password.placeholder = server && data.sync.hasPassword ? "변경하지 않으려면 비워 두세요" : "";
  connectOpen = true;
  message("");
  renderStorage();
  f.url.focus();
}
$("#btn-open-connect").onclick = openConnect;
$("#btn-edit-connect").onclick = openConnect;
$("#connect-cancel").onclick = () => {
  connectOpen = false;
  message("");
  renderStorage();
};

// 서버와 이 기기 규칙이 다를 때 → "merge" | "remote" | "local" | null(취소)
function askConflict() {
  const dlg = $("#conflict");
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => resolve(dlg.returnValue || null), { once: true });
    dlg.returnValue = "";
    dlg.showModal();
  });
}
for (const btn of $$("#conflict button")) btn.onclick = () => $("#conflict").close(btn.value);

$("#form-connect").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const payload = { url: f.url.value.trim(), username: f.username.value.trim(), password: f.password.value };
  let res = await run("sync:connect", payload);
  if (res.ask) {
    const choice = await askConflict();
    if (!choice) return message("연결을 취소했습니다");
    res = await run("sync:connect", { ...payload, choice });
  }
  if (res.ok && !res.ask) {
    f.password.value = "";
    connectOpen = false;
    renderStorage();
  }
};
$("#btn-sync").onclick = () => run("sync:now");
$("#btn-sync-browser").onclick = () => run("sync:now");
$("#btn-disconnect").onclick = async () => {
  if (!confirm("브라우저 동기화로 전환할까요?\n지금 규칙을 브라우저 계정 동기화와 합치고 서버 연결을 끊습니다. 서버의 파일은 그대로 남습니다.")) return;
  const res = await run("sync:disconnect");
  if (res.ok) message("브라우저 동기화로 전환했습니다");
};

function renderSettings() {
  $("#usSection").hidden = data.userScripts;
  $("#usBanner").hidden = data.userScripts;
  $("#badge").checked = !data.settings.hideBadge;
  renderBrowser();
  renderBridge();
  renderStorage();
}

$("#openExtensions").onclick = async () => {
  const url = `edge://extensions/?id=${data.extensionId}`;
  try {
    await chrome.tabs.create({ url });
  } catch {
    await navigator.clipboard.writeText(url);
    toast("주소를 복사했습니다. 새 탭 주소창에 붙여 넣으세요");
  }
};
$("#recheck").onclick = async () => {
  const { available } = await send("userscripts:check");
  await reload();
  toast(available ? "사용자 스크립트가 켜져 있습니다" : "아직 꺼져 있습니다");
};

$("#bEnabled").onchange = async (e) => {
  await send("bridge:config", { patch: { enabled: e.target.checked } });
  await reload();
};
$("#bEval").onchange = (e) => send("bridge:config", { patch: { allowEval: e.target.checked } });
$("#bSetupCmd").textContent = BRIDGE_SETUP;
$("#bCopySetup").onclick = async () => {
  await navigator.clipboard.writeText(BRIDGE_SETUP);
  toast("복사했습니다. PowerShell 이나 cmd 에 붙여 넣고 Enter");
};
$("#bCopySetupMcp").onclick = async () => {
  await navigator.clipboard.writeText(setupCommand(chrome.runtime.id, "-WithMcp"));
  toast("복사했습니다. PowerShell 이나 cmd 에 붙여 넣고 Enter");
};
$("#bRetry").onclick = async () => {
  await send("bridge:retry");
  setTimeout(reload, 800);
};

$("#badge").onchange = (e) => send("settings", { patch: { hideBadge: !e.target.checked } });

$("#export").onclick = async () => {
  const { json } = await send("export");
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pagepatch-rules-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$("#importBtn").onclick = () => $("#importFile").click();
$("#importFile").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const box = $("#importReport");
  box.hidden = false;
  box.className = "desc";
  box.replaceChildren();
  try {
    const json = JSON.parse(await file.text());
    const { report } = await send("import", { json });
    const p = document.createElement("div");
    p.className = "desc ok";
    p.textContent = `규칙 ${report.count}개${report.jumps ? `, 검색 이동 키워드 ${report.jumps}개` : ""}를 가져왔습니다.`;
    box.append(p);
    if (report.warnings?.length) {
      const ul = document.createElement("ul");
      for (const w of report.warnings) {
        const li = document.createElement("li");
        li.textContent = w;
        ul.append(li);
      }
      box.append(ul);
    }
    await reload();
  } catch (err) {
    box.className = "desc error";
    box.textContent = `가져오지 못했습니다: ${err.message}`;
  }
};

// ── 불러오기·주소 ──

async function reload() {
  data = await send("state");
  renderList();
  renderSites();
  renderJumps();
  renderSettings();
}

function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash === "settings" || hash === "unlock" || hash === "jump") return showView(hash);
  showView("rules");
  if (hash.startsWith("rule=")) {
    const r = data.rules.find((x) => x.id === hash.slice(5));
    if (r && r.id !== current?.id) openRule(r);
  } else if (hash.startsWith("new=")) {
    let urls = "";
    try {
      urls = `*://${new URL(hash.slice(4)).host}/*`;
    } catch {}
    let host = "";
    try {
      host = new URL(hash.slice(4)).hostname.replace(/^www\./, "");
    } catch {}
    openRule({ ...emptyRule(urls), name: host });
    history.replaceState(null, "", "#");
  } else if (!current && data.rules.length) {
    // 처음 들어왔을 때(편집 중인 규칙 없음)는 목록 맨 위 규칙을 연다
    const r = data.rules[0];
    history.replaceState(null, "", `#rule=${r.id}`);
    openRule(r);
  }
}
window.addEventListener("hashchange", route);

// 다른 곳(사이드바의 Claude, 동기화, 팝업)에서 바뀐 것을 반영
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && (changes.rules || changes.jumps || changes.settings || changes.syncStatus || changes.bridge || changes.syncConfig)) {
    if (busy) return;
    if ((changes.syncStatus || changes.syncConfig) && Date.now() - lastRunEnd > 1500) message("");
    await reload();
    if (changes.rules && current?.id && !saving) {
      const r = data.rules.find((x) => x.id === current.id);
      if (!r) return;
      const o = current.original;
      const changed = r.name !== o.name || r.urls !== o.urls || r.css !== o.css || r.js !== o.js || (r.notes || "") !== (o.notes || "") || FLAGS.some((k) => r.flags[k] !== o.flags[k]);
      if (!changed) return;
      if (isDirty()) $("#changedNotice").hidden = false;
      else openRule(r);
    }
  } else if (area === "session" && data && (changes.bridgeStatus || changes.ruleErrors)) {
    if (changes.bridgeStatus) data.bridgeStatus = changes.bridgeStatus.newValue;
    if (changes.ruleErrors) data.errors = changes.ruleErrors.newValue || {};
    renderBridge();
    renderList();
  }
});

await reload();
route();
renderHints();
