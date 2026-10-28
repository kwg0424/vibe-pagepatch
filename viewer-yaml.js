// YAML · TOML · INI · INC 주소를 직접 열면 줄 번호와 색을 입혀 보여 준다 (파서 없이 줄 단위로 칠함. 접기 · 정리는 없음). 틀은 viewer-common.js.

(() => {
  // 값 부분: 문자열 / 주석 / true false / null / 숫자(날짜 포함) / YAML 앵커 · 태그 / 그 밖은 그대로
  const VALUE = [
    ["s", /"(?:\\.|[^"\\])*"?|'[^']*'?/y],
    ["c", /(?:#|(?<=\s);).*/y],
    ["bo", /(?:true|false)\b/iy],
    ["nu", /(?:null|~)(?=\s|,|]|}|$)/iy],
    ["n", /[+-]?\d[\d_]*(?:[.:\-]\d+)*(?:[eE][+-]?\d+)?(?:T[\d:.Z+-]+)?\b|[+-]?\.(?:inf|nan)\b/iy],
    ["f", /[&*][\w-]+/y],
    ["kw", /!{1,2}[\w!./-]*|[|>][+-]?(?=\s*$)/y],
  ];

  function match(src, i, re) {
    re.lastIndex = i;
    const m = re.exec(src);
    return m && m.index === i && m[0] ? m[0] : null;
  }

  function values(text, iniComment) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      let hit = null;
      for (const [cls, re] of VALUE) {
        if (cls === "c" && iniComment === false && text[i] === ";") continue; // YAML · TOML 은 # 만 주석
        const t = match(text, i, re);
        if (t) {
          hit = [cls, t];
          break;
        }
      }
      if (!hit) {
        // 글자 하나씩 모아서 한 조각으로
        const last = out.at(-1);
        if (last && last[0] === "") last[1] += text[i];
        else out.push(["", text[i]]);
        i++;
      } else {
        out.push(hit);
        i += hit[1].length;
      }
    }
    return out;
  }

  const KEY = /^(\s*(?:-\s+)*)("[^"]*"|'[^']*'|[^\s:#'"\[\]{},&*!|>%@`-][^:#]*?|-[^\s:#][^:#]*?)(\s*:)(?=\s|$)/;
  const INI_KEY = /^(\s*)([^=:;#\[\s][^=:]*?)(\s*[=:])(.*)$/;

  function highlight(text, lang) {
    const out = [];
    const lines = text.split("\n");
    lines.forEach((line, n) => {
      const tail = n < lines.length - 1 ? "\n" : "";
      let m;
      if (/^\s*#/.test(line) || (lang === "ini" && /^\s*;/.test(line))) out.push(["c", line]);
      else if (lang === "yaml" && /^(---|\.\.\.)(\s|$)/.test(line)) out.push(["kw", line.slice(0, 3)], ...values(line.slice(3), false));
      else if (lang !== "yaml" && (m = /^(\s*)(\[\[?[^\]=]*\]\]?)(.*)$/.exec(line))) {
        // [table] · [[array]] · [section]
        out.push(["", m[1]], ["sec", m[2]], ...values(m[3], lang === "ini"));
      } else if (lang === "yaml" && (m = KEY.exec(line))) {
        out.push(["", m[1]], ["k", m[2]], ["", m[3]], ...values(line.slice(m[0].length), false));
      } else if (lang !== "yaml" && (m = INI_KEY.exec(line))) {
        out.push(["", m[1]], ["k", m[2]], ["", m[3]], ...values(m[4], lang === "ini" ? true : false));
      } else out.push(...values(line, lang === "ini" ? true : false));
      if (tail) out.push(["", tail]);
    });
    return out;
  }

  const TYPES = [
    [/^(application|text)\/(x-)?yaml$/i, "yaml"],
    [/^(application|text)\/(x-)?toml$/i, "toml"],
  ];
  const EXTS = { yml: "yaml", yaml: "yaml", toml: "toml", ini: "ini", cfg: "ini", properties: "ini", inc: "ini" };

  function main() {
    const P = globalThis.PPView;
    const page = P?.plainText();
    if (!page) return;
    const { pre, text, ct } = page;
    const lang = TYPES.find(([re]) => re.test(ct))?.[1] || (ct === "text/plain" ? EXTS[P.fileExt()] : null);
    if (!lang) return;
    P.enabled("yaml").then((on) => {
      if (!on) return;
      const big = P.isBig(text);
      P.mount({
        pre,
        ext: P.fileExt() === "inc" ? "INC" : lang === "ini" ? "INI" : lang.toUpperCase(),
        css: P.LINE_CSS,
        startRaw: big,
        note: big ? P.bigNote(text) : "",
        build: () => {
          const view = P.el("div");
          view.append(...P.toLines(highlight(text, lang)));
          return view;
        },
        copy: () => text, // 정리 · 접기가 없어서 어느 상태든 원문 그대로
        prettyLabel: "색 입혀 보기",
      });
    });
  }

  if (typeof module !== "undefined") module.exports = { highlight }; // 테스트용
  else main();
})();
