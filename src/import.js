// 가져오기: PagePatch 내보내기 파일, 또는 원본 확장(User JavaScript and CSS) 데이터.
// 원본 데이터 = 저장소 통째 ({ rules: [메타], "r:<id>": { js, scss, css }, libs, settings })
//   - tools/export-from-original.mjs 로 뽑은 파일, 원본의 'Download JSON' 파일 모두 이 모양
// → { state: { rules, settings? }, report }
import { normalizeRule, normalizeSettings, FLAGS } from "./model.js";
import { lineCommentsToBlock } from "./css.js";

export const EXPORT_APP = "PagePatch";

export function exportState(state) {
  return { app: EXPORT_APP, version: 1, exportedAt: new Date().toISOString(), rules: Object.values(state.rules).filter((r) => !r.deleted), settings: state.settings };
}

export function importData(json, now = Date.now()) {
  if (!json || typeof json !== "object") throw new Error("JSON 파일이 아닙니다");
  if (json.app === EXPORT_APP) return importOwn(json, now);
  if (Array.isArray(json.rules)) return importOriginal(json, now);
  if (json.sites) throw new Error("원본 확장의 아주 예전 형식입니다. 원본 확장을 최신으로 업데이트한 뒤 다시 내보내세요");
  throw new Error("알 수 없는 파일 형식입니다");
}

function importOwn(json, now) {
  const rules = {};
  for (const r of json.rules || []) {
    const n = normalizeRule({ ...r, updated: r.updated || now });
    if (n && !n.deleted) rules[n.id] = n;
  }
  return {
    state: { rules, settings: json.settings ? { ...normalizeSettings(json.settings), updated: now } : null },
    report: { format: "PagePatch", count: Object.keys(rules).length, warnings: [] },
  };
}

const FLAG_MAP = { isoStyle: "isoCSS" };
const DROPPED_OK = new Set(["shared", "dontSync"]);

function importOriginal(json, now) {
  const libs = new Map((json.libs || []).map((l) => [l.id, l]));
  const rules = {};
  const dropped = {};
  const warnings = [];
  let comments = 0;

  for (const meta of json.rules) {
    if (!meta?.id) continue;
    const content = json[meta.id] || json.content?.[meta.id] || meta;
    const flags = {};
    for (const f of meta.flags || []) {
      const k = FLAG_MAP[f] || f;
      if (FLAGS.includes(k)) flags[k] = true;
      else dropped[f] = (dropped[f] || 0) + 1;
    }
    // CSS: 원본은 SCSS 소스(scss)와 컴파일 결과(css)를 따로 둔다 → 소스를 쓰고 // 주석만 /* */ 로 바꾼다
    const source = typeof content.scss === "string" && content.scss.trim() ? content.scss : content.css || "";
    const converted = lineCommentsToBlock(source);
    comments += converted.changed;

    const name = meta.name || "";
    const label = name || meta.urls || meta.id;
    const usedLibs = (meta.libs || []).map((id) => libs.get(id)).filter(Boolean);
    if (usedLibs.length) warnings.push(`"${label}": 라이브러리(${usedLibs.map((l) => l.name).join(", ")})를 쓰던 규칙입니다. PagePatch 는 라이브러리를 넣지 않으므로 JS 를 순수 JS 로 고쳐야 동작합니다`);
    if (/\$\w+\s*:|&[:.\s]|\{[^{}]*\{/.test(stripComments(converted.css).replace(/@media[^{]*\{/g, ""))) warnings.push(`"${label}": SCSS 문법(변수·중첩)이 있을 수 있습니다. CSS 를 확인하세요`);

    const rule = normalizeRule({
      id: meta.id,
      name,
      urls: meta.urls || "",
      js: content.js || "",
      css: converted.css,
      flags,
      created: meta.created,
      updated: now, // 가져온 시각 → 다른 기기의 같은 id 규칙보다 이걸 쓴다
    });
    if (rule) rules[rule.id] = rule;
  }

  for (const [f, n] of Object.entries(dropped)) if (!DROPPED_OK.has(f)) warnings.push(`알 수 없는 옵션 "${f}" ${n}개를 뺐습니다`);
  const settings = typeof json.settings?.badgeCounter === "boolean" ? { hideBadge: !json.settings.badgeCounter, updated: now } : null;
  return {
    state: { rules, settings },
    report: { format: "User JavaScript and CSS", count: Object.keys(rules).length, dropped, comments, warnings },
  };
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
