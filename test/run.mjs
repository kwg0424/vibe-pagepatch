#!/usr/bin/env node
// PagePatch 테스트 (브라우저 없이): node test/run.mjs
//   URL 변환·매칭, CSS 처리, 가져오기, 합치기, 브라우저 동기화 조각, 규칙 JS 감싸기, 브리지(호스트 ↔ MCP) 왕복
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { convertPattern, parseUrls, compilePattern, ruleMatchesUrl, urlGuardCode } from "../src/urls.js";
import { addImportant, lineCommentsToBlock } from "../src/css.js";
import { importData, exportState } from "../src/import.js";
import { mergeStates, sameState } from "../src/merge.js";
import { normalizeRule, normalizeState, normalizeSettings, normalizeHost } from "../src/model.js";
import { toItems, fromItems, diffItems, ITEM_MAX } from "../src/syncitems.js";
import { jsCode, jsSources, cssCode, buildScripts } from "../src/inject.js";
import { toQwerty, toHangul } from "../src/hangul.js";
import { jumpKey, variants, ruleCandidates, matchers } from "../src/jump.js";
import { renderMarkdown } from "../src/markdown.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ── AI 규칙 (notes) ──
test("AI 규칙: 규칙에 notes 보관 · 비교", () => {
  assert.equal(normalizeRule({ id: "x", flags: {} }).notes, ""); // 예전 규칙
  assert.equal(normalizeRule({ id: "x", notes: "## 목적", flags: {} }).notes, "## 목적");
  const a = normalizeRule({ id: "x", notes: "a", flags: {}, updated: 1 });
  assert.equal(sameState({ rules: { x: a } }, { rules: { x: { ...a, notes: "b" } } }), false);
});
test("AI 규칙 마크다운: 태그 이스케이프 · 목록 · 링크", () => {
  const html = renderMarkdown("## 목적\n<img src=x onerror=alert(1)>\n\n- 배너\n  - 하위\n1. 하나\n\n[a](https://a.com) [b](javascript:alert(1))");
  assert.ok(html.includes("<h2>목적</h2>"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("<ul><li>배너<ul><li>하위</li></ul></li></ul><ol><li>하나</li></ol>"));
  assert.ok(html.includes('<a href="https://a.com"'));
  assert.ok(!html.includes('href="javascript'));
});

// ── URL ──
test("원본과 같은 URL 변환", () => {
  assert.equal(convertPattern("example.com"), "https://*.example.com/*");
  assert.equal(convertPattern("https://a.example.com/"), "https://a.example.com/*");
  assert.equal(convertPattern("*://www.example.com/*"), "*://www.example.com/*");
  assert.equal(convertPattern("*"), "https://*/*");
  assert.equal(convertPattern("http*://x.example.com/p"), "*://x.example.com/p*");
  assert.equal(convertPattern("!ads.example.com"), "https://ads.example.com/*");
});
test("parseUrls: 제외·잘못된 패턴", () => {
  const r = parseUrls("example.com, !*://ads.example.com/*", false);
  assert.deepEqual(r.matches, ["https://*.example.com/*"]);
  assert.deepEqual(r.excludeMatches, ["*://ads.example.com/*"]);
  assert.deepEqual(parseUrls("*://a.com/x, !*://a.com/x/y*", true).excludeMatches, ["*://a.com/x/y*"]);
  assert.deepEqual(parseUrls("notapattern", true).invalid, ["notapattern"]);
});
test("match pattern 매칭", () => {
  const p = compilePattern("*://*.example.com/watch*");
  assert.ok(p.test("https://www.example.com/watch?v=1"));
  assert.ok(p.test("http://example.com/watch"));
  assert.ok(!p.test("https://example.org/watch"));
  assert.ok(!p.test("https://www.example.com/"));
  assert.ok(compilePattern("https://*/*").test("https://anything.test/a/b"));
  assert.ok(!compilePattern("*://www.example.com/").test("https://www.example.com/a"));
  const rule = { urls: "*://e.com/*, !*://e.com/skip*", flags: { strictUrl: true } };
  assert.ok(ruleMatchesUrl(rule, "https://e.com/a"));
  assert.ok(!ruleMatchesUrl(rule, "https://e.com/skip/1"));
});

test("정규식 URL: 쉼표 포함·제외·잘못된 정규식", () => {
  const p = parseUrls("example.com, /^https:\\/\\/v\\.test\\/(a|b){1,2}\\//i, !/skip/, /[/,]x/, /(bad/", false);
  assert.deepEqual(p.matches, ["https://*.example.com/*"]);
  assert.deepEqual(p.regex, [{ source: "^https:\\/\\/v\\.test\\/(a|b){1,2}\\/", flags: "i" }, { source: "[/,]x", flags: "" }]);
  assert.deepEqual(p.excludeRegex, [{ source: "skip", flags: "" }]);
  assert.deepEqual(p.invalid, ["/(bad/"]);
  const rule = { urls: "/^https:\\/\\/v\\.test\\/(a|b)/, !/skip/", flags: {} };
  assert.ok(ruleMatchesUrl(rule, "https://v.test/a/1"));
  assert.ok(!ruleMatchesUrl(rule, "https://v.test/c"));
  assert.ok(!ruleMatchesUrl(rule, "https://v.test/a/skip"));
});

// ── CSS ──
test("자동 !important", () => {
  assert.equal(addImportant("a{color:red;margin:0}"), "a{color:red !important;margin:0 !important}");
  assert.equal(addImportant("a { color: red !important; }"), "a { color: red !important; }");
  assert.equal(addImportant("@media (max-width:1px){a{top:0}}"), "@media (max-width:1px){a{top:0 !important}}");
  assert.equal(addImportant("@keyframes k{from{top:0}to{top:1px}}"), "@keyframes k{from{top:0}to{top:1px}}");
  assert.equal(addImportant("a{background:url(data:x;base64,AAA);--v:1}"), "a{background:url(data:x;base64,AAA) !important;--v:1}");
  assert.equal(addImportant("a{/* c */color:red}"), "a{/* c */color:red !important}");
});
test("// 주석 → /* */", () => {
  const { css, changed } = lineCommentsToBlock("// a\nb{background:url(http://x/y)} // c\n/* d // e */");
  assert.equal(css, "/* a */\nb{background:url(http://x/y)} /* c */\n/* d // e */");
  assert.equal(changed, 2);
});

// ── 가져오기 ──
const ORIGINAL = {
  info: { version: 11 },
  libs: [{ id: "m:1", name: "jQuery 3", src: "@extension@jquery.min.js", type: "js" }],
  settings: { badgeCounter: true },
  rules: [
    { id: "r:a", name: "site a", urls: "*://a.test/*", flags: ["strictUrl", "isoStyle", "dontSync"], libs: ["m:1"], created: 1, updated: 2 },
    { id: "r:b", name: "", urls: "b.test", flags: ["off", "isoJS", "weird"], libs: [], created: 3, updated: 4 },
  ],
  "r:a": { js: "$('x').hide()", scss: "// note\na { color: red; }", css: "a{color:red}" },
  "r:b": { js: "", scss: "", css: "b{top:0}" },
};
test("원본 데이터 가져오기", () => {
  const { state, report } = importData(ORIGINAL, 1000);
  assert.equal(report.count, 2);
  const a = state.rules["r:a"];
  assert.equal(a.css, "/* note */\na { color: red; }");
  assert.ok(a.flags.strictUrl && a.flags.isoCSS && !a.flags.isoJS);
  assert.equal(a.updated, 1000);
  assert.equal(state.rules["r:b"].css, "b{top:0}");
  assert.ok(state.rules["r:b"].flags.off && state.rules["r:b"].flags.isoJS);
  assert.equal(state.settings.hideBadge, false);
  assert.ok(report.warnings.some((w) => w.includes("jQuery")));
  assert.ok(report.warnings.some((w) => w.includes("weird")));
  assert.ok(!report.warnings.some((w) => w.includes("dontSync")));
});
test("PagePatch 내보내기 → 가져오기", () => {
  const { state } = importData(ORIGINAL, 1000);
  const back = importData(JSON.parse(JSON.stringify(exportState(state))), 2000);
  assert.equal(back.report.count, 2);
  assert.equal(back.state.rules["r:a"].css, state.rules["r:a"].css);
});

// ── 복사 제한 해제 ──
test("우클릭·복사 사이트: 주소 맞추기·정렬·둘 다 끈 사이트 빼기", () => {
  assert.equal(normalizeHost("https://www.Example.com/path"), "www.example.com");
  assert.equal(normalizeHost("example.com"), "example.com");
  assert.equal(normalizeHost("localhost"), "localhost"); // 팝업이 넘기는 점 없는 호스트도 저장된다
  assert.equal(normalizeHost("http://localhost:3000/x"), "localhost");
  assert.equal(normalizeHost("Bad Host"), null);
  const sites = normalizeSettings({ sites: { "b.test": { copy: 1 }, "a.test": { strong: true }, "off.test": { copy: false, strong: false }, "Bad Host": { copy: true } } }).sites;
  assert.deepEqual(Object.keys(sites), ["a.test", "b.test"]);
  assert.deepEqual(sites["b.test"], { copy: true, strong: false });
  assert.deepEqual(normalizeSettings(null).sites, {});
});
test("사이트 목록은 설정과 같이 합치고 storage.sync 로 오간다", () => {
  const a = { rules: {}, settings: { sites: { "new.test": { copy: true } }, updated: 5 } };
  const b = { rules: {}, settings: { sites: { "old.test": { copy: true } }, updated: 2 } };
  assert.deepEqual(Object.keys(mergeStates(a, b).settings.sites), ["new.test"]);
  const state = normalizeState(a);
  assert.ok(sameState(fromItems(toItems(state)), state));
});

// ── 검색 이동 (StayTab 의 주소창 키워드) ──
test("한/영 자판 변환", () => {
  assert.equal(toQwerty("지도"), "wleh");
  assert.equal(toQwerty("닭값"), "ekfrrkqt"); // 겹받침
  assert.equal(toQwerty("왜"), "dho"); // 겹모음
  assert.equal(toQwerty("빠ㄱ"), "Qkr"); // 쌍자음, 낱자
  assert.equal(toHangul("wleh"), "지도");
  assert.equal(toHangul("gksk"), "하나"); // 받침이 다음 글자 첫소리로
  assert.equal(toHangul("ekfrk"), "달가"); // 겹받침 나누기
  for (const w of ["메일", "네이버 지도", "쿠팡", "뷁", "읽기", "없어"]) assert.equal(toHangul(toQwerty(w)), w);
});

// DNR 은 RE2 로 맞춘다. 여기 쓰는 문법은 JS 정규식과 같으므로 JS 로 확인한다 (대소문자 무시)
const MAP = "https://map.naver.com/p/";
const jumpsOf = (o) => Object.fromEntries(Object.entries(o).map(([k, url]) => [jumpKey(k), { id: jumpKey(k), url, updated: 1 }]));
const goes = (jumps, url) => matchers(jumps).find((m) => m.re.test(url))?.url ?? null;
const eq = (s) => s.split(" ").map(encodeURIComponent).join("+"); // 주소창 검색처럼 공백은 +

test("검색 이동: 키워드는 띄어쓰기를 지워 저장", () => {
  assert.equal(jumpKey("구글 지도"), "구글지도");
  assert.equal(jumpKey("  Google  Maps "), "googlemaps");
  assert.equal(jumpKey("   "), null);
  assert.equal(jumpKey("가".repeat(41)), null);
  assert.deepEqual(variants("지도"), ["지도", "wleh"]);
  assert.deepEqual(variants("map"), ["map", "ㅡ메"]);
});

test("검색 이동: 띄어쓰기 상관없이, 한/영 전환 없이, 검색엔진 5곳", () => {
  const jumps = jumpsOf({ "구글 지도": MAP });
  for (const term of ["구글 지도", "구글지도", "구글  지도", "구 글 지 도", "rnrmf wleh", "RNRMFWLEH"]) {
    assert.equal(goes(jumps, `https://www.google.com/search?q=${eq(term)}&oq=x&sourceid=chrome`), MAP, term);
    assert.equal(goes(jumps, `https://www.google.co.kr/search?q=${eq(term)}`), MAP, term);
    assert.equal(goes(jumps, `https://www.bing.com/search?q=${eq(term)}&form=QBLH`), MAP, term);
    assert.equal(goes(jumps, `https://search.naver.com/search.naver?where=nexearch&query=${eq(term)}`), MAP, term);
    assert.equal(goes(jumps, `https://search.daum.net/search?w=tot&q=${eq(term)}`), MAP, term);
    assert.equal(goes(jumps, `https://duckduckgo.com/?q=${eq(term)}&t=h_`), MAP, term);
  }
  assert.equal(goes(jumps, `https://www.google.com/search?q=${encodeURIComponent("구글 지도")}`), MAP); // 공백 %20
  assert.equal(goes(jumps, `https://www.google.com/search?q=${encodeURIComponent("구글지도").toLowerCase()}`), MAP); // 소문자 인코딩
});

test("검색 이동: 키워드가 들어간 다른 검색은 그대로", () => {
  const jumps = jumpsOf({ 지도: MAP, "c++": "https://isocpp.org/" });
  for (const url of [
    `https://www.google.com/search?q=${eq("지도 앱")}`,
    `https://www.google.com/search?q=${eq("서울지도")}`,
    `https://www.google.com/search?q=wleh2`,
    `https://www.google.com/search?oq=${eq("지도")}&q=${eq("지도 보기")}`, // oq 만 같음
    `https://www.google.com/maps?q=${eq("지도")}`,
    `https://www.example.com/search?q=${eq("지도")}`,
    `https://www.google.com/search?q=cxx`,
  ]) assert.equal(goes(jumps, url), null, url);
  assert.equal(goes(jumps, `https://www.google.com/search?q=${encodeURIComponent("c++")}`), "https://isocpp.org/");
});

// urlFilter 문법 → JS 정규식 (앞뒤 | 는 시작·끝 고정, * 는 아무거나)
const filterRe = (f) => {
  const end = f.endsWith("|");
  const body = f.slice(1, end ? -1 : undefined).replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "*" ? ".*" : "\\" + c));
  return new RegExp(`^${body}${end ? "$" : ""}`, "i");
};
test("검색 이동: 긴 키워드는 urlFilter 로 (띄어쓰기 없는 모양만, 다른 검색은 그대로)", () => {
  const id = jumpKey("가나다라마바사아자차카");
  const c = ruleCandidates({ [id]: { id, url: MAP } })[0]; // 구글
  assert.ok(c.combined && c.each.length === 2 && c.each.every((e) => e.regex && e.filters.length));
  const hits = (url) => c.each.some((e) => e.filters.some((f) => filterRe(f).test(url)));
  assert.ok(hits(`https://www.google.com/search?q=${eq(id)}&sourceid=chrome`));
  assert.ok(hits(`https://www.google.co.kr/search?ie=UTF-8&q=${eq(id)}`));
  assert.ok(hits(`https://www.google.com/search?q=${eq(id)}`));
  assert.ok(hits(`https://www.google.com/search?q=${toQwerty(id)}&oq=x`)); // 한/영 전환 없이
  assert.ok(!hits(`https://www.google.com/search?q=${eq(id + " 앱")}&sourceid=chrome`));
  assert.ok(!hits(`https://www.google.com/search?oq=${eq(id)}&q=x`));
  assert.ok(!hits(`https://www.bing.com/search?q=${eq(id)}`)); // 이 후보는 구글용
});

test("검색 이동 키워드: 항목마다 합치고 storage.sync · 내보내기로 오간다", () => {
  const a = { rules: {}, jumps: { 지도: { id: "지도", url: "https://new.test/", updated: 5 }, 메일: { id: "메일", deleted: 6, updated: 6 } } };
  const b = { rules: {}, jumps: { 지도: { id: "지도", url: "https://old.test/", updated: 2 }, 메일: { id: "메일", url: "https://mail.test/", updated: 3 }, 쿠팡: { id: "쿠팡", url: "https://coupang.com", updated: 1 } } };
  const m = mergeStates(a, b, 10);
  assert.ok(sameState(m, mergeStates(b, a, 10)));
  assert.equal(m.jumps.지도.url, "https://new.test/");
  assert.ok(m.jumps.메일.deleted);
  assert.equal(m.jumps.쿠팡.url, "https://coupang.com/"); // 주소 맞춤
  assert.ok(sameState(fromItems(toItems(normalizeState(m))), normalizeState(m)));
  assert.ok(Object.keys(toItems(normalizeState(m))).includes("jump:지도"));
  const back = importData(JSON.parse(JSON.stringify(exportState(normalizeState(m)))), 99);
  assert.deepEqual(Object.keys(back.state.jumps).sort(), ["지도", "쿠팡"]); // 지운 것은 내보내지 않음
  assert.equal(normalizeState({ jumps: { x: { id: "구글 지도", url: "a.com" } } }).jumps["구글지도"].url, "https://a.com/");
});

test("새 탭 · 탭 복원 설정 기본값", () => {
  const s = normalizeSettings(null);
  assert.equal(s.restore, false);
  assert.deepEqual(s.newtab, { on: true, url: "https://www.naver.com/" });
  assert.deepEqual(normalizeSettings({ newtab: { on: false } }).newtab, { on: false, url: "https://www.naver.com/" });
});

// ── 합치기 ──
const rule =(id, updated, extra = {}) => normalizeRule({ id, name: id, urls: "a.test", updated, created: 1, ...extra });
test("합치기: 최신 우선, 삭제 전파, 순서 무관", () => {
  const a = { rules: { x: rule("x", 5, { css: "new" }), y: rule("y", 1) }, settings: { hideBadge: true, updated: 3 } };
  const b = { rules: { x: rule("x", 2, { css: "old" }), y: { id: "y", deleted: 4, updated: 4 }, z: rule("z", 1) }, settings: { hideBadge: false, updated: 1 } };
  const ab = mergeStates(a, b, 10);
  const ba = mergeStates(b, a, 10);
  assert.ok(sameState(ab, ba));
  assert.equal(ab.rules.x.css, "new");
  assert.ok(ab.rules.y.deleted);
  assert.ok(ab.rules.z);
  assert.equal(ab.settings.hideBadge, true);
  // 30일 지난 삭제 표시는 정리
  assert.ok(!mergeStates(b, {}, 4 + 31 * 86400000).rules.y);
});

// ── 브라우저 동기화 항목 ──
test("storage.sync 항목: 큰 규칙은 조각으로", () => {
  const big = rule("big", 1, { css: "가".repeat(9000) + "\n" + "a{}".repeat(500) });
  const state = normalizeState({ rules: [big, rule("small", 1)], settings: { hideBadge: true, updated: 1 } });
  const items = toItems(state);
  for (const [k, v] of Object.entries(items)) assert.ok(new TextEncoder().encode(k + JSON.stringify(v)).length <= 8192, k);
  assert.ok(items["rule:big"].chunks > 1);
  assert.ok(sameState(fromItems(items), state));
  const { set, remove } = diffItems({ ...items, "rule:gone": {} }, items);
  assert.deepEqual(Object.keys(set), []);
  assert.deepEqual(remove, ["rule:gone"]);
  assert.ok(ITEM_MAX < 8192);
});

// ── 규칙 JS 감싸기 ──
test("규칙 JS 감싸기: 문법·전역 유지·onload", () => {
  const r = rule("j", 1, { js: "var g = 1; function f() { return g; } // 끝 주석" });
  const code = jsCode(r);
  new Function(code); // 문법 확인
  assert.ok(!/=>\s*\{\s*\n?var g/.test(code));
  const onload = jsCode({ ...r, flags: { ...r.flags, onLoadJS: true } });
  new Function(onload);
  assert.ok(onload.includes('addEventListener("load"'));
  assert.ok(jsCode({ ...r, flags: { ...r.flags, onLoadJS: true } }, { spa: true }).includes("spa: true"));
  new Function(cssCode(rule("c", 1, { css: "a{color:red}`${x}`" })));
});
test("JS · CSS 따로 끄기: 꺼 둔 쪽은 등록하지 않는다", () => {
  const rules = {
    j: rule("j", 1, { js: "1", css: "a{}", flags: { offJS: true } }),
    c: rule("c", 1, { js: "1", css: "a{}", flags: { offCSS: true } }),
    n: rule("n", 1, { js: "1", css: "a{}", flags: { offJS: true, offCSS: true } }),
  };
  assert.deepEqual(buildScripts(rules).scripts.map((s) => s.script.id).sort(), ["c", "j:css"]);
  assert.equal(normalizeRule({ id: "x", flags: {} }).flags.offJS, false); // 예전 규칙은 둘 다 켜짐
});
test("등록할 스크립트", () => {
  const rules = {
    a: rule("a", 1, { js: "1", css: "a{}", flags: { isoJS: true, deepJS: true, atStartJS: true } }),
    b: rule("b", 1, { css: "b{}", flags: { isoCSS: true } }),
    c: rule("c", 1, { js: "1", flags: { off: true } }),
    d: rule("d", 1, { js: "1", urls: "", flags: {} }),
  };
  const { scripts, errors } = buildScripts(rules);
  const ids = scripts.map((s) => s.script.id).sort();
  assert.deepEqual(ids, ["a", "a:css"]);
  const a = scripts.find((s) => s.script.id === "a").script;
  assert.equal(a.world, "USER_SCRIPT");
  assert.equal(a.allFrames, true);
  assert.equal(a.runAt, "document_start");
  assert.ok(errors.d);
});
test("페이지 환경 규칙은 원본처럼 그대로 실행 (앞뒤 감시 스크립트)", () => {
  const r = rule("m", 1, { js: "async function helper() {}\nconst k = 1;" });
  const src = jsSources(r);
  assert.equal(src.length, 3);
  assert.equal(src[1].code, r.js); // 감싸지 않음 → async function·const 도 전역
  for (const s of src) new Function(s.code);
  assert.equal(jsSources({ ...r, flags: { ...r.flags, isoJS: true } }).length, 1);
});
test("정규식 규칙: 넓게 등록 + 페이지에서 주소 검사", () => {
  const rules = { r: rule("r", 1, { urls: "/v\\.test\\/watch/", js: "x()", css: "a{}" }) };
  const { scripts } = buildScripts(rules);
  const js = scripts.find((s) => s.script.id === "r").script;
  assert.deepEqual(js.matches, ["*://*/*"]);
  assert.ok(js.js[0].code.startsWith("if (("));
  new Function(js.js[0].code);
  const css = scripts.find((s) => s.script.id === "r:css").script;
  new Function(css.js[0].code);
  // 검사식이 실제로 맞게 판단하는지
  const guard = urlGuardCode(parseUrls("/v\\.test\\/watch/, *://other.test/*, !/nope/", false));
  const run = (href) => {
    const u = new URL(href);
    return new Function("location", `return ${guard}`)({ href, protocol: u.protocol, hostname: u.hostname, port: u.port, pathname: u.pathname, search: u.search });
  };
  assert.equal(run("https://v.test/watch?v=1"), true);
  assert.equal(run("https://other.test/x"), true);
  assert.equal(run("https://v.test/home"), false);
  assert.equal(run("https://other.test/nope"), false);
});

// ── 브리지: 가짜 확장 ↔ host.mjs ↔ mcp.mjs ──
test("브리지 왕복 (도구 호출)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pagepatch-"));
  const env = { ...process.env, LOCALAPPDATA: tmp };
  const host = spawn(process.execPath, [path.join(ROOT, "bridge", "host.mjs")], { env, stdio: ["pipe", "pipe", "inherit"] });
  const frame = (o) => {
    const b = Buffer.from(JSON.stringify(o));
    const h = Buffer.alloc(4);
    h.writeUInt32LE(b.length);
    return Buffer.concat([h, b]);
  };
  // 확장처럼: hello → call 이 오면 결과
  let buf = Buffer.alloc(0);
  const fromHost = [];
  host.stdout.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
      const msg = JSON.parse(buf.subarray(4, 4 + buf.readUInt32LE(0)).toString());
      buf = buf.subarray(4 + buf.readUInt32LE(0));
      fromHost.push(msg);
      if (msg.type === "call") host.stdin.write(frame({ type: "result", id: msg.id, result: { echo: msg.tool, args: msg.args } }));
    }
  });
  host.stdin.write(frame({ type: "hello", version: "test" }));
  const bridgeFile = path.join(tmp, "PagePatch", "bridge.json");
  for (let i = 0; i < 50 && !fs.existsSync(bridgeFile); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(fs.existsSync(bridgeFile), "bridge.json");
  assert.ok(fromHost.some((m) => m.type === "hello"));

  const mcp = spawn(process.execPath, [path.join(ROOT, "bridge", "mcp.mjs")], { env: { ...env, PAGEPATCH_TAB: "42" }, stdio: ["pipe", "pipe", "inherit"] });
  const replies = new Map();
  let out = "";
  mcp.stdout.on("data", (d) => {
    out += d;
    let i;
    while ((i = out.indexOf("\n")) >= 0) {
      const line = out.slice(0, i);
      out = out.slice(i + 1);
      if (line.trim()) {
        const m = JSON.parse(line);
        replies.set(m.id, m);
      }
    }
  });
  const rpc = async (id, method, params) => {
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    for (let i = 0; i < 100 && !replies.has(id); i++) await new Promise((r) => setTimeout(r, 50));
    return replies.get(id);
  };
  try {
    const init = await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.equal(init.result.serverInfo.name, "pagepatch");
    const list = await rpc(2, "tools/list", {});
    assert.ok(list.result.tools.some((t) => t.name === "css_preview"));
    const call = await rpc(3, "tools/call", { name: "page_query", arguments: { selector: ".x" } });
    const echoed = JSON.parse(call.result.content[0].text);
    assert.equal(echoed.echo, "page_query");
    assert.equal(echoed.args.tabId, 42); // 사이드바 채팅의 탭이 기본값으로
    assert.equal(echoed.args.selector, ".x");

    // 브라우저 페이지(Origin 있음)는 거절
    const { port, token } = JSON.parse(fs.readFileSync(bridgeFile, "utf8"));
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { headers: { Origin: "https://evil.test", Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13" } }).catch((e) => e);
    assert.ok(!(res instanceof Response) || res.status === 403);
    // 토큰이 틀리면 끊긴다
    const bad = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/mcp`);
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: "x".repeat(token.length) }));
      ws.onmessage = () => resolve("accepted");
      ws.onclose = () => resolve("closed");
    });
    assert.equal(bad, "closed");
  } finally {
    mcp.kill();
    host.stdin.end();
    await new Promise((r) => host.on("close", r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

for (const [name, fn] of tests) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.log(`  ✗ ${name}\n    ${e.stack?.split("\n").slice(0, 3).join("\n    ")}`);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${tests.length} 통과`);
