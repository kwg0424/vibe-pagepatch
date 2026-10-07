// Claude Code 브리지가 부르는 도구들 (bridge/server.mjs 의 도구 목록과 이름·인자가 같다).
// 탭을 고르지 않으면 마지막으로 쓴 Edge 창의 활성 탭.
import { getState, saveRule, getHistory, revertRule } from "./store.js";
import { matchingRules, userScriptsAvailable, ruleCss, getRuns } from "./inject.js";
import { parseUrls } from "./urls.js";
import { FLAGS, liveRules, sortByName } from "./model.js";
import { addImportant } from "./css.js";

// ctx: { refresh() → { errors }, getBridgeConfig() }
let ctx = null;
export const initTools = (c) => (ctx = c);

const injectable = (url) => /^(https?|file):/.test(url || "");

async function targetTab(tabId) {
  const tab = tabId ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab) throw new Error("열린 탭이 없습니다");
  if (!injectable(tab.url)) throw new Error(`이 탭은 다룰 수 없습니다 (브라우저 내부 페이지): ${tab.url}`);
  return tab;
}

async function inPage(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r?.result;
}

const summary = (r, errors = {}) => ({
  id: r.id,
  name: r.name,
  urls: r.urls,
  on: !r.flags.off,
  options: FLAGS.filter((k) => k !== "off" && r.flags[k]),
  jsLength: r.js.length,
  cssLength: r.css.length,
  hasNotes: !!r.notes?.trim(),
  updated: new Date(r.updated).toISOString(),
  ...(errors[r.id] ? { error: errors[r.id] } : {}),
});

async function ruleErrors() {
  const { ruleErrors = {} } = await chrome.storage.session.get("ruleErrors");
  return ruleErrors;
}

// ── 페이지에서 실행되는 함수들 (직렬화되어 들어가므로 바깥 변수를 쓰지 않는다) ──

function outlineInPage(selector, maxDepth, maxNodes) {
  const root = selector ? document.querySelector(selector) : document.body;
  if (!root) return { error: `요소 없음: ${selector}` };
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META"]);
  const lines = [];
  let count = 0;
  const walk = (el, depth) => {
    if (count >= maxNodes || SKIP.has(el.tagName)) return;
    count++;
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = [...el.classList];
    if (cls.length) s += `.${cls.slice(0, 6).join(".")}${cls.length > 6 ? "…" : ""}`;
    for (const a of ["role", "aria-label", "data-testid", "name", "type", "href"]) {
      const v = el.getAttribute(a);
      if (v) s += ` [${a}="${v.slice(0, 60)}"]`;
    }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === "none") s += " (display:none)";
    else if (r.width === 0 && r.height === 0) s += " (크기 0)";
    else if (depth <= 3) s += ` (${Math.round(r.width)}×${Math.round(r.height)})`;
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .replace(/\s+/g, " ");
    if (text) s += ` "${text.slice(0, 50)}${text.length > 50 ? "…" : ""}"`;
    lines.push("  ".repeat(depth) + s);
    if (el.tagName === "svg") return;
    const kids = [...el.children];
    if (depth >= maxDepth) {
      if (kids.length) lines.push(`${"  ".repeat(depth + 1)}… 자식 ${kids.length}개`);
      return;
    }
    for (const k of kids) walk(k, depth + 1);
  };
  walk(root, 0);
  return { text: lines.join("\n"), nodes: count, truncated: count >= maxNodes };
}

function queryInPage(selector, limit, props) {
  let list;
  try {
    list = [...document.querySelectorAll(selector)];
  } catch (e) {
    return { error: `잘못된 셀렉터: ${e.message}` };
  }
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 6; e = e.parentElement) {
      if (e.id) {
        parts.unshift(`#${CSS.escape(e.id)}`);
        break;
      }
      let p = e.tagName.toLowerCase();
      const sib = e.parentElement ? [...e.parentElement.children].filter((x) => x.tagName === e.tagName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(e) + 1})`;
      parts.unshift(p);
    }
    return parts.join(" > ");
  };
  const items = list.slice(0, limit).map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const html = el.outerHTML;
    return {
      path: path(el),
      html: html.length > 1500 ? `${html.slice(0, 1500)}…` : html,
      text: (el.innerText || "").slice(0, 200),
      rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      visible: r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0",
      styles: Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])),
    };
  });
  return { count: list.length, items };
}

function setPreviewInPage(css) {
  let s = document.getElementById("pagepatch-preview");
  if (css === null) {
    s?.remove();
    return { cleared: true };
  }
  if (!s) {
    s = document.createElement("style");
    s.id = "pagepatch-preview";
  }
  s.textContent = css;
  (document.head || document.documentElement).appendChild(s); // 맨 뒤 → 다른 스타일보다 우선
  return { applied: true };
}

const DEFAULT_STYLES = ["display", "position", "width", "height", "margin", "padding", "color", "background-color", "font-size", "font-family", "z-index", "overflow", "visibility", "opacity"];

async function executeUserScript(tabId, code, world) {
  if (!userScriptsAvailable() || !chrome.userScripts.execute) throw new Error("사용자 스크립트를 쓸 수 없습니다. edge://extensions 에서 PagePatch 의 '사용자 스크립트 허용'을 켜세요 (Edge 135 이상)");
  const res = await chrome.userScripts.execute({ target: { tabId }, js: [{ code }], world, injectImmediately: true });
  const r = res?.[0];
  if (r?.error) throw new Error(r.error);
  return r?.result;
}

// ── 도구 ──

const tools = {
  async page_info({ tabId }) {
    const tab = await targetTab(tabId);
    const [state, errors, runs] = [await getState(), await ruleErrors(), await getRuns(tab.id)];
    return {
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      userScripts: userScriptsAvailable(),
      spaNavigated: runs.spa, // 이 탭에서 SPA 이동이 있었음 → spaJS 가 아닌 규칙 JS 는 새 주소에서 실행 안 됐을 수 있음
      rules: matchingRules(state, tab.url).map((r) => ({ ...summary(r, errors), jsRun: r.js.trim() ? runs.rules[r.id] || { status: "not-run" } : undefined })),
    };
  },

  async page_outline({ tabId, selector, depth = 8, maxNodes = 300 }) {
    const tab = await targetTab(tabId);
    return inPage(tab.id, outlineInPage, [selector || null, Math.min(depth, 30), Math.min(maxNodes, 2000)]);
  },

  async page_query({ tabId, selector, limit = 5, styles }) {
    if (!selector) throw new Error("selector 가 필요합니다");
    const tab = await targetTab(tabId);
    return inPage(tab.id, queryInPage, [selector, Math.min(limit, 50), styles?.length ? styles : DEFAULT_STYLES]);
  },

  async page_screenshot({ tabId }) {
    const tab = await targetTab(tabId);
    if (!tab.active) throw new Error("화면에 보이는 탭만 캡처할 수 있습니다. 그 탭을 먼저 여세요");
    const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
    return { url: tab.url, image };
  },

  async css_preview({ tabId, css, important = false }) {
    if (typeof css !== "string") throw new Error("css 가 필요합니다");
    const tab = await targetTab(tabId);
    return inPage(tab.id, setPreviewInPage, [important ? addImportant(css) : css]);
  },

  async preview_clear({ tabId }) {
    const tab = await targetTab(tabId);
    await inPage(tab.id, setPreviewInPage, [null]);
    return { cleared: true, note: "미리 실행한 JS 의 효과는 되돌릴 수 없습니다. 필요하면 page_reload" };
  },

  async js_preview({ tabId, js, world = "USER_SCRIPT" }) {
    if (typeof js !== "string") throw new Error("js 가 필요합니다");
    const tab = await targetTab(tabId);
    const wrapped = `{ try {\n${js}\n} catch (e) { throw e; } }`;
    await executeUserScript(tab.id, wrapped, world === "MAIN" ? "MAIN" : "USER_SCRIPT");
    return { ran: true };
  },

  async page_eval({ tabId, code, world = "MAIN" }) {
    const cfg = await ctx.getBridgeConfig();
    if (!cfg.allowEval) throw new Error("page_eval 이 꺼져 있습니다. PagePatch 설정 → Claude Code → '페이지에서 JS 실행 허용'을 켜야 합니다");
    if (typeof code !== "string") throw new Error("code 가 필요합니다");
    const tab = await targetTab(tabId);
    const result = await executeUserScript(tab.id, code, world === "USER_SCRIPT" ? "USER_SCRIPT" : "MAIN");
    let json;
    try {
      json = JSON.stringify(result);
    } catch {
      json = String(result);
    }
    return { result: json && json.length > 20000 ? `${json.slice(0, 20000)}…` : (json ?? "undefined") };
  },

  async page_reload({ tabId }) {
    const tab = await targetTab(tabId);
    await chrome.tabs.reload(tab.id);
    return { reloaded: tab.url };
  },

  async page_console({ tabId, clear = false }) {
    const tab = await targetTab(tabId);
    const { logs = {} } = await chrome.storage.session.get("logs");
    const list = logs[tab.id] || [];
    if (clear) {
      delete logs[tab.id];
      await chrome.storage.session.set({ logs });
    }
    return { url: tab.url, logs: list };
  },

  async rules_list({ url }) {
    const [state, errors] = [await getState(), await ruleErrors()];
    const list = url ? matchingRules(state, url) : sortByName(liveRules(state.rules));
    return { rules: list.map((r) => summary(r, errors)) };
  },

  async rule_get({ id }) {
    const state = await getState();
    const r = state.rules[id];
    if (!r || r.deleted) throw new Error(`규칙 없음: ${id}`);
    const { matches, excludeMatches, invalid } = parseUrls(r.urls, r.flags.strictUrl);
    return { ...r, created: new Date(r.created).toISOString(), updated: new Date(r.updated).toISOString(), matches, excludeMatches, invalid, injectedCss: r.flags.important ? ruleCss(r) : undefined, error: (await ruleErrors())[id] };
  },

  async rule_save({ id, name, urls, js, css, notes, options }) {
    const state = await getState();
    if (id && (!state.rules[id] || state.rules[id].deleted)) throw new Error(`규칙 없음: ${id}. 새로 만들려면 id 를 빼세요`);
    if (!id && !urls) throw new Error("새 규칙에는 urls 가 필요합니다");
    const flags = {};
    for (const [k, v] of Object.entries(options || {})) {
      if (!FLAGS.includes(k)) throw new Error(`알 수 없는 옵션: ${k} (가능: ${FLAGS.join(", ")})`);
      flags[k] = !!v;
    }
    const input = { id, flags };
    for (const [k, v] of Object.entries({ name, urls, js, css, notes })) if (typeof v === "string") input[k] = v;
    const rule = await saveRule(input, "claude");
    const { errors } = await ctx.refresh();
    const { matches, excludeMatches, invalid } = parseUrls(rule.urls, rule.flags.strictUrl);
    return {
      rule: summary(rule, errors),
      matches,
      excludeMatches,
      invalid,
      note: "CSS 는 열린 탭에 바로 적용됐습니다. JS 는 페이지를 새로고침해야 실행됩니다 (page_reload). 미리보기를 썼다면 preview_clear 로 지우세요",
    };
  },

  async rule_history({ id }) {
    const list = await getHistory(id);
    return { versions: list.map((v, index) => ({ index, time: new Date(v.t).toISOString(), by: v.by, name: v.name, urls: v.urls, jsLength: v.js.length, cssLength: v.css.length, notesLength: (v.notes || "").length })) };
  },

  async rule_revert({ id, index }) {
    const rule = await revertRule(id, index, "claude");
    await ctx.refresh();
    return { rule: summary(rule) };
  },
};

export async function runTool(name, args) {
  const fn = tools[name];
  if (!fn) throw new Error(`알 수 없는 도구: ${name}`);
  return fn(args || {});
}
