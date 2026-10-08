// 규칙을 페이지에 넣는다.
//   JS                → chrome.userScripts 에 규칙마다 스크립트 1개 (id = 규칙 id)
//   CSS (기본)        → userScripts 로 <style data-pagepatch> 를 넣는 스크립트 (id = 규칙 id + ":css")
//   CSS (isoCSS)      → 탭마다 chrome.scripting.insertCSS (origin USER). 사용자 스크립트가 꺼져 있으면 모든 CSS 를 이 방식으로
// SPA 에서 주소만 바뀌면 (content.js 가 알려 줌) CSS 를 다시 맞춘다. JS 는 다시 실행하지 않는다 (원본과 같음).
import { parseUrls, ruleMatchesUrl, registrationPatterns, urlGuardCode } from "./urls.js";
import { addImportant } from "./css.js";
import { liveRules, runsJs, runsCss } from "./model.js";

export function userScriptsAvailable() {
  try {
    chrome.userScripts.getScripts().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export const ruleCss = (r) => (r.flags.important ? addImportant(r.css) : r.css);
const active = (r) => !r.deleted && !r.flags.off;

// 규칙 JS 를 감싼다.
//   - 실행 결과를 알린다 (pagepatch:log 이벤트 → content.js → background): ran(실행됨) / waiting(onload 기다림) / error
//     → 팝업의 '실행됨 / 실행 안 됨 / 오류' 표시, Claude 의 page_console
//   - 규칙 안에서 쓸 수 있는 PagePatch 객체:
//       PagePatch.log/warn/error(...)  기록 (Claude 가 page_console 로 봄)
//       PagePatch.url                  실행할 때 주소,  PagePatch.spa  SPA 이동으로 다시 실행된 것인지
//       PagePatch.onLeave(fn)          SPA 로 규칙에 안 맞는 주소로 떠날 때 fn 실행 (바꾼 것 되돌리기)
//   감싸는 방식:
//     페이지 환경(MAIN) + 기본·일찍 실행 → 원본처럼 규칙 코드를 그대로 실행 (const·async function·class 도 전역 → 콘솔에서 부를 수 있음).
//       앞뒤에 작은 스크립트를 붙여 실행 여부·오류만 알아낸다 (jsSources)
//     격리 환경(USER_SCRIPT), onload 실행, SPA 다시 실행 → 블록(onload 는 함수)으로 감싸 try/catch (jsCode)
//       격리 환경 전역은 어차피 콘솔에서 못 보고, SPA 다시 실행은 const 중복 선언 오류를 피해야 하므로
export function jsSources(r) {
  if (r.flags.isoJS || (r.flags.onLoadJS && !r.flags.atStartJS)) return [{ code: jsCode(r) }];
  const id = JSON.stringify(r.id);
  const prelude = `// PagePatch: ${(r.name || r.urls).replace(/\n/g, " ")} (시작)
(() => {
  const report = (level, args) => { try { document.dispatchEvent(new CustomEvent("pagepatch:log", { detail: JSON.stringify({ rule: ${id}, level, message: args.map((a) => typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(" ") }) })); } catch {} };
  const run = { report, failed: false };
  run.onError = (e) => { run.failed = true; report("error", [String((e.error && e.error.stack) || e.message)]); };
  window.addEventListener("error", run.onError);
  Object.defineProperty(window, "__pagepatchRun", { value: run, configurable: true, writable: true, enumerable: false });
  window.PagePatch = {
    url: location.href,
    spa: false,
    log: (...a) => report("log", a), warn: (...a) => report("warn", a), error: (...a) => report("error", a),
    onLeave: (fn) => { const h = (e) => { if (e.detail !== ${id}) return; document.removeEventListener("pagepatch:leave", h); try { fn(); } catch (err) { report("error", [String((err && err.stack) || err)]); } }; document.addEventListener("pagepatch:leave", h); },
  };
})();`;
  const epilogue = `(() => {
  const run = window.__pagepatchRun;
  if (!run) return;
  window.removeEventListener("error", run.onError);
  if (!run.failed) run.report("ran", [location.href]);
})();`;
  return [{ code: prelude }, { code: r.js }, { code: epilogue }];
}

export function jsCode(r, { spa = false } = {}) {
  const id = JSON.stringify(r.id);
  const name = JSON.stringify(r.name || r.urls);
  const prelude = `const __pp = (level, args) => { try { document.dispatchEvent(new CustomEvent("pagepatch:log", { detail: JSON.stringify({ rule: ${id}, level, message: args.map((a) => typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(" ") }) })); } catch {} };
let __ok = true;
const PagePatch = {
  url: location.href,
  spa: ${spa},
  log: (...a) => __pp("log", a), warn: (...a) => __pp("warn", a), error: (...a) => __pp("error", a),
  onLeave: (fn) => { const h = (e) => { if (e.detail !== ${id}) return; document.removeEventListener("pagepatch:leave", h); try { fn(); } catch (err) { __pp("error", [String((err && err.stack) || err)]); } }; document.addEventListener("pagepatch:leave", h); },
};`;
  const body = `try {
${r.js}
} catch (e) { __ok = false; __pp("error", [String((e && e.stack) || e)]); console.error("[PagePatch]", ${name}, e); }
if (__ok) __pp("ran", [location.href]);`;
  const header = `// PagePatch: ${(r.name || r.urls).replace(/\n/g, " ")}`;
  if (r.flags.onLoadJS && !r.flags.atStartJS && !spa)
    return `${header}
{
${prelude}
const __run = () => {
${body}
};
if (document.readyState === "complete") __run();
else { __pp("waiting", [location.href]); window.addEventListener("load", __run, { once: true }); }
}`;
  return `${header}
{
${prelude}
${body}
}`;
}

export function cssCode(r) {
  return `(() => {
const id = ${JSON.stringify(`pagepatch-${r.id}`)};
const css = ${JSON.stringify(ruleCss(r))};
const put = () => {
  let s = document.getElementById(id);
  if (!s) { s = document.createElement("style"); s.id = id; s.dataset.pagepatch = ${JSON.stringify(r.id)}; }
  if (s.textContent !== css) s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
};
put();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", put, { once: true });
})();`;
}

// 등록할 스크립트 목록 → { scripts: [{ ruleId, script }], errors: { ruleId: 메시지 } }
export function buildScripts(rules) {
  const scripts = [];
  const errors = {};
  for (const r of liveRules(rules).filter(active)) {
    const hasJs = runsJs(r);
    const hasCss = runsCss(r) && !r.flags.isoCSS;
    if (!hasJs && !hasCss) continue;
    const parsed = parseUrls(r.urls, r.flags);
    if (parsed.invalid.length) errors[r.id] = `잘못된 URL 패턴: ${parsed.invalid.join(", ")}`;
    const { matches, excludeMatches, guard } = registrationPatterns(parsed);
    if (!matches.length) {
      errors[r.id] ||= "URL 패턴이 비어 있습니다";
      continue;
    }
    const base = { matches, ...(excludeMatches.length ? { excludeMatches } : {}) };
    // 정규식이 있으면 넓게 등록하고 페이지에서 주소를 다시 검사한다
    const check = guard ? urlGuardCode(parsed) : null;
    if (hasJs)
      scripts.push({
        ruleId: r.id,
        script: {
          id: r.id,
          ...base,
          js: check ? [{ code: `if (${check}) ${jsCode(r)}` }] : jsSources(r),
          world: r.flags.isoJS ? "USER_SCRIPT" : "MAIN",
          allFrames: r.flags.deepJS,
          runAt: r.flags.atStartJS ? "document_start" : "document_end",
        },
      });
    if (hasCss)
      scripts.push({
        ruleId: r.id,
        script: { id: `${r.id}:css`, ...base, js: [{ code: check ? `if (${check}) ${cssCode(r)}` : cssCode(r) }], world: "USER_SCRIPT", allFrames: r.flags.deepCSS, runAt: "document_start" },
      });
  }
  return { scripts, errors };
}

const scriptKey = (s) =>
  JSON.stringify([s.matches, s.excludeMatches || [], (s.js || []).map((j) => j.code), s.world || "USER_SCRIPT", !!s.allFrames, s.runAt || "document_idle"]);

// userScripts 등록을 규칙에 맞춘다 (바뀐 것만). → { available, errors }
export async function syncRegistrations(state) {
  if (!userScriptsAvailable()) return { available: false, errors: {} };
  const { scripts, errors } = buildScripts(state.rules);
  const existing = await chrome.userScripts.getScripts();
  const want = new Map(scripts.map((s) => [s.script.id, s]));
  const stale = existing.filter((s) => !want.has(s.id)).map((s) => s.id);
  if (stale.length) await chrome.userScripts.unregister({ ids: stale });
  const have = new Map(existing.map((s) => [s.id, s]));
  for (const { ruleId, script } of scripts) {
    const ex = have.get(script.id);
    if (ex && scriptKey(ex) === scriptKey(script)) continue;
    try {
      if (ex) await chrome.userScripts.unregister({ ids: [script.id] });
      await chrome.userScripts.register([script]);
    } catch (e) {
      errors[ruleId] = `등록 실패: ${e?.message || e}`;
    }
  }
  return { available: true, errors };
}

export const matchingRules = (state, url) => liveRules(state.rules).filter((r) => ruleMatchesUrl(r, url));

const injectable = (url) => /^(https?|file):/.test(url || "");

// 탭 하나의 CSS 를 맞춘다. fresh = 새로 로드됨 (이전에 넣은 CSS 는 이미 사라졌음)
export async function applyTab(tabId, url, state, { fresh = false } = {}) {
  if (!injectable(url)) return;
  const available = userScriptsAvailable();
  const matching = matchingRules(state, url).filter((r) => active(r) && runsCss(r));

  // insertCSS 방식
  const want = {};
  for (const r of matching) if (r.flags.isoCSS || !available) want[r.id] = { css: ruleCss(r), allFrames: r.flags.deepCSS };
  const { tabCss = {} } = await chrome.storage.session.get("tabCss");
  const had = fresh ? {} : tabCss[tabId] || {};
  const target = (allFrames) => ({ tabId, allFrames });
  for (const [id, v] of Object.entries(had)) {
    if (want[id]?.css === v.css && want[id]?.allFrames === v.allFrames) continue;
    await chrome.scripting.removeCSS({ target: target(v.allFrames), css: v.css, origin: "USER" }).catch(() => {});
  }
  for (const [id, v] of Object.entries(want)) {
    if (had[id]?.css === v.css && had[id]?.allFrames === v.allFrames) continue;
    await chrome.scripting.insertCSS({ target: target(v.allFrames), css: v.css, origin: "USER" }).catch(() => {});
  }
  const { tabCss: latest = {} } = await chrome.storage.session.get("tabCss");
  latest[tabId] = want;
  await chrome.storage.session.set({ tabCss: latest });

  // <style> 방식: 등록된 스크립트는 새로 로드할 때만 돈다 → 이미 열린 페이지(규칙 수정, SPA 이동)는 여기서 맞춘다
  if (available && !fresh) {
    const tags = {};
    for (const r of matching) if (!r.flags.isoCSS) tags[r.id] = ruleCss(r);
    await chrome.scripting
      .executeScript({
        target: { tabId },
        func: (tags) => {
          for (const s of document.querySelectorAll("style[data-pagepatch]")) if (!(s.dataset.pagepatch in tags)) s.remove();
          for (const [id, css] of Object.entries(tags)) {
            let s = document.getElementById(`pagepatch-${id}`);
            if (!s) {
              s = document.createElement("style");
              s.id = `pagepatch-${id}`;
              s.dataset.pagepatch = id;
              (document.head || document.documentElement).appendChild(s);
            }
            if (s.textContent !== css) s.textContent = css;
          }
        },
        args: [tags],
      })
      .catch(() => {});
  }
}

// ── 탭마다 JS 실행 상태 ──
// session: runs = { [tabId]: { spa: SPA 이동이 있었는지, rules: { [ruleId]: { status: ran|waiting|error|left, url, t, error } } } }
let runsQueue = Promise.resolve();
export function updateRuns(tabId, fn) {
  const run = runsQueue.then(async () => {
    const { runs = {} } = await chrome.storage.session.get("runs");
    const tab = runs[tabId] || { spa: false, rules: {} };
    const next = fn(tab);
    if (next === null) delete runs[tabId];
    else runs[tabId] = next || tab;
    await chrome.storage.session.set({ runs });
    return runs[tabId];
  });
  runsQueue = run.catch(() => {});
  return run;
}

export async function getRuns(tabId) {
  const { runs = {} } = await chrome.storage.session.get("runs");
  return runs[tabId] || { spa: false, rules: {} };
}

// SPA 이동 (주소만 바뀜). CSS 는 applyTab 이 맞추고, JS 는 여기서:
//   - 전에 실행된 규칙이 새 주소에 안 맞으면 pagepatch:leave 이벤트 (규칙의 PagePatch.onLeave)
//   - spaJS 규칙이 새 주소에 맞으면 다시 실행
//   - spaJS 가 아닌 규칙은 다시 실행하지 않는다 (원본과 같음) → 팝업에 'SPA 이동이라 실행 안 됨'
export async function spaNavigate(tabId, url, state) {
  const matching = matchingRules(state, url).filter((r) => active(r) && runsJs(r));
  const before = await getRuns(tabId);
  const leaving = Object.entries(before.rules)
    .filter(([id, v]) => (v.status === "ran" || v.status === "waiting") && !matching.some((r) => r.id === id))
    .map(([id]) => id);
  if (leaving.length)
    await chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        func: (ids) => ids.forEach((id) => document.dispatchEvent(new CustomEvent("pagepatch:leave", { detail: id }))),
        args: [leaving],
      })
      .catch(() => {});
  await updateRuns(tabId, (t) => {
    t.spa = true;
    for (const id of leaving) t.rules[id] = { ...t.rules[id], status: "left", t: Date.now() };
  });
  if (!userScriptsAvailable() || !chrome.userScripts.execute) return;
  for (const r of matching.filter((x) => x.flags.spaJS)) {
    await chrome.userScripts
      .execute({ target: { tabId }, js: [{ code: jsCode(r, { spa: true }) }], world: r.flags.isoJS ? "USER_SCRIPT" : "MAIN", injectImmediately: true })
      .catch((e) => updateRuns(tabId, (t) => void (t.rules[r.id] = { status: "error", url, t: Date.now(), error: e?.message || String(e) })));
  }
}

export async function applyAllTabs(state) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter((t) => injectable(t.url)).map((t) => applyTab(t.id, t.url, state)));
}

export async function forgetTab(tabId) {
  await updateRuns(tabId, () => null);
  const { tabCss = {} } = await chrome.storage.session.get("tabCss");
  if (!(tabId in tabCss)) return;
  delete tabCss[tabId];
  await chrome.storage.session.set({ tabCss });
}
