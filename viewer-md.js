// Markdown 주소를 직접 열면 문서 모양으로 보여 준다. 틀은 viewer-common.js.
// 글은 전부 textContent 로만 넣고(HTML 로 해석하지 않음), 링크 · 그림 주소는 http · https · mailto 만 허용한다.
// 지원: 제목, 굵게 · 기울임 · 취소선, 인라인 코드, 코드 블록, 목록(중첩 · 할 일), 인용, 표, 가로선, 링크, 그림. 수식 · 다이어그램 · 각주는 하지 않는다.

(() => {
  const el = (...args) => globalThis.PPView.el(...args);

  // 안전한 주소만 돌려준다 (아니면 null)
  function safeUrl(u, protocols) {
    try {
      const url = new URL(u, location.href);
      return protocols.includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  // 내 컴퓨터의 파일(file://)을 열었을 때만 같은 컴퓨터의 그림 · 링크를 허용한다 (웹 주소의 글이 내 파일을 부르지 못하게)
  const LOCAL = typeof location !== "undefined" && location.protocol === "file:" ? ["file:"] : [];

  const RULES = [
    ["code", /(`+)([\s\S]*?[^`])\1(?!`)/],
    ["img", /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/],
    ["a", /\[((?:[^[\]]|\[[^\]]*\])+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/],
    ["auto", /<(https?:\/\/[^>\s]+)>/],
    ["b", /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/],
    ["i", /\*(?=\S)([\s\S]*?\S)\*|\b_(?=\S)([\s\S]*?\S)_\b/],
    ["del", /~~(?=\S)([\s\S]*?\S)~~/],
    ["url", /https?:\/\/[^\s<>]*[^\s<>.,;:!?)\]'"]/],
    ["esc", /\\([\\`*_{}[\]()#+\-.!|~>])/],
    ["br", /(?: {2,}|\\)\n/],
  ];

  function link(text, href, parent, children) {
    const url = safeUrl(href, ["http:", "https:", "mailto:", ...LOCAL]);
    if (!url) return parent.append(children ? children : text);
    const a = el("a");
    a.href = url;
    if (!href.startsWith("#")) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    children ? inline(children, a) : (a.textContent = text);
    parent.append(a);
  }

  function inline(text, parent) {
    while (text) {
      let best = null;
      for (const [name, re] of RULES) {
        const m = re.exec(text);
        if (m && (!best || m.index < best.m.index)) best = { name, m };
      }
      if (!best) return parent.append(text);
      const { name, m } = best;
      if (m.index) parent.append(text.slice(0, m.index));
      text = text.slice(m.index + m[0].length);
      if (name === "code") parent.append(el("code", "", m[2].replace(/^ (.*) $/, "$1")));
      else if (name === "img") {
        // 그림은 항상 <img> 로 둔다: 파일이 없거나 열 수 없으면 브라우저의 깨진 그림(엑박)과 대체 글이 보인다
        const src = safeUrl(m[2], ["http:", "https:", ...LOCAL]);
        const img = el("img");
        img.alt = m[1];
        img.title = m[1];
        if (src) {
          img.src = src;
          img.referrerPolicy = "no-referrer";
        }
        parent.append(img);
      } else if (name === "a") link(m[1], m[2], parent, m[1]);
      else if (name === "auto" || name === "url") link(m[1] || m[0], m[1] || m[0], parent);
      else if (name === "b") inline(m[1] || m[2], parent.appendChild(el("strong")));
      else if (name === "i") inline(m[1] || m[2], parent.appendChild(el("em")));
      else if (name === "del") inline(m[1], parent.appendChild(el("del")));
      else if (name === "esc") parent.append(m[1]);
      else parent.append(el("br"));
    }
  }

  const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)/;
  const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const QUOTE = /^\s{0,3}>/;
  const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, "|"));

  const startsBlock = (line, next) =>
    FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || ITEM.test(line) || (line.includes("|") && next !== undefined && TABLE_SEP.test(next));

  function blocks(src, parent) {
    const lines = src.replace(/\r\n?/g, "\n").split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (!line.trim()) i++;
      else if ((m = FENCE.exec(line))) {
        const fence = m[1];
        const body = [];
        for (i++; i < lines.length && !new RegExp(`^\\s{0,3}${fence[0]}{${fence.length},}\\s*$`).test(lines[i]); i++) body.push(lines[i]);
        i++;
        const pre = el("pre", "code");
        pre.append(el("code", "", body.join("\n")));
        parent.append(pre);
      } else if ((m = HEADING.exec(line))) {
        inline(m[2], parent.appendChild(el("h" + m[1].length)));
        i++;
      } else if (HR.test(line)) {
        parent.append(el("hr"));
        i++;
      } else if (QUOTE.test(line)) {
        const inner = [];
        for (; i < lines.length && QUOTE.test(lines[i]); i++) inner.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        blocks(inner.join("\n"), parent.appendChild(el("blockquote")));
      } else if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        const align = cells(lines[i + 1]).map((c) => (/^:-*:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : ""));
        const table = el("table");
        const thead = table.appendChild(el("thead")).appendChild(el("tr"));
        cells(line).forEach((c, k) => {
          const th = thead.appendChild(el("th"));
          th.style.textAlign = align[k] || "";
          inline(c, th);
        });
        const tbody = table.appendChild(el("tbody"));
        for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes("|"); i++) {
          const tr = tbody.appendChild(el("tr"));
          cells(lines[i]).forEach((c, k) => {
            const td = tr.appendChild(el("td"));
            td.style.textAlign = align[k] || "";
            inline(c, td);
          });
        }
        parent.append(table);
      } else if ((m = ITEM.exec(line))) {
        i = list(lines, i, parent);
      } else {
        const para = [line];
        for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1]); i++) para.push(lines[i]);
        inline(para.join("\n").trim(), parent.appendChild(el("p")));
      }
    }
  }

  // 목록: 같은 들여쓰기의 항목들. 더 들여쓴 줄은 그 항목 안(중첩 목록 · 이어지는 글)
  function list(lines, i, parent) {
    const first = ITEM.exec(lines[i]);
    const base = first[1].length;
    const ordered = /\d/.test(first[2]);
    const ul = parent.appendChild(el(ordered ? "ol" : "ul"));
    if (ordered && parseInt(first[2], 10) !== 1) ul.start = parseInt(first[2], 10);
    while (i < lines.length) {
      const m = ITEM.exec(lines[i]);
      if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
      const inner = [m[3]];
      for (i++; i < lines.length; i++) {
        const l = lines[i];
        if (!l.trim()) {
          const nx = lines.slice(i + 1).find((x) => x.trim());
          if (nx !== undefined && (/^\s+/.exec(nx)?.[0].length ?? 0) > base) {
            inner.push("");
            continue;
          }
          break;
        }
        const ind = /^\s*/.exec(l)[0].length;
        if (ind <= base) break;
        inner.push(l.slice(Math.min(ind, base + 2)));
      }
      const li = ul.appendChild(el("li"));
      const task = /^\[([ xX])\]\s+/.exec(inner[0]);
      if (task) {
        const box = el("input");
        box.type = "checkbox";
        box.disabled = true;
        box.checked = task[1] !== " ";
        li.className = "task";
        li.append(box);
        inner[0] = inner[0].slice(task[0].length);
      }
      blocks(inner.join("\n"), li);
    }
    return i;
  }

  const CSS = `
    #pp-view { width: 100%; max-width: min(860px, calc(100% - 32px)); padding: 22px 36px 30px; color: #abb2bf; font: calc(var(--pp-fs, 13px) * 1.2)/1.75 "Segoe UI", "Malgun Gothic", sans-serif; word-break: break-word; }
    #pp-view h1, #pp-view h2, #pp-view h3, #pp-view h4, #pp-view h5, #pp-view h6 { margin: 1.4em 0 .6em; color: #e6e6e6; line-height: 1.3; }
    #pp-view > :first-child { margin-top: 0; }
    #pp-view h1 { font-size: 1.9em; padding-bottom: .3em; border-bottom: 1px solid #3e4451; } #pp-view h2 { font-size: 1.5em; padding-bottom: .25em; border-bottom: 1px solid #3e4451; }
    #pp-view h3 { font-size: 1.25em; } #pp-view h4 { font-size: 1.1em; } #pp-view h5, #pp-view h6 { font-size: 1em; color: #9da5b4; }
    #pp-view p, #pp-view ul, #pp-view ol, #pp-view table, #pp-view pre, #pp-view blockquote { margin: 0 0 1em; }
    #pp-view a { color: #61afef; }
    #pp-view code { padding: 2px 6px; background: #21252b; border-radius: 4px; color: #e5c07b; font: .9em Consolas, "D2Coding", monospace; }
    #pp-view pre.code { padding: 12px 16px; overflow-x: auto; background: #21252b; border: 1px solid #333842; border-radius: 8px; white-space: pre; word-break: normal; }
    #pp-view pre.code code { padding: 0; background: none; color: #abb2bf; font-size: .95em; }
    #pp-view blockquote { padding: 0 16px; border-left: 4px solid #4b5263; color: #9da5b4; }
    #pp-view ul, #pp-view ol { padding-left: 1.7em; } #pp-view li > p { margin: 0; } #pp-view li > ul, #pp-view li > ol { margin: .2em 0 0; }
    #pp-view li.task { margin-left: -1.4em; list-style: none; } #pp-view li.task > p:first-of-type { display: inline; }
    #pp-view li input[type=checkbox] { margin: 0 .5em 0 0; vertical-align: middle; }
    #pp-view table { border-collapse: collapse; display: block; overflow-x: auto; } #pp-view th, #pp-view td { padding: 6px 12px; border: 1px solid #3e4451; }
    #pp-view th { background: #21252b; color: #e6e6e6; } #pp-view tbody tr:nth-child(even) { background: rgba(255, 255, 255, .03); }
    #pp-view hr { margin: 1.5em 0; border: 0; border-top: 1px solid #3e4451; }
    #pp-view img { max-width: 100%; } #pp-view del { color: #7f8794; } #pp-view strong { color: #e6e6e6; }
  `;

  const EXTS = new Set(["md", "markdown", "mdown", "mkd"]);

  function main() {
    const P = globalThis.PPView;
    const page = P?.plainText();
    if (!page) return;
    const { pre, text, ct } = page;
    if (!(/^text\/(x-)?(web-)?markdown$/i.test(ct) || (ct === "text/plain" && EXTS.has(P.fileExt())))) return;
    P.enabled("md").then((on) => {
      if (!on) return;
      const big = P.isBig(text);
      let view;
      P.mount({
        pre,
        ext: "Markdown",
        css: CSS,
        startRaw: big,
        note: big ? P.bigNote(text) : "",
        build: () => {
          view = P.el("div");
          blocks(text, view);
          return view;
        },
        // 내용 복사: 원본 상태는 마크다운 원문, 정리 상태는 보이는 글
        copy: (raw) => (raw || !view ? text : view.innerText),
        prettyLabel: "문서로 보기",
      });
    });
  }

  if (typeof module !== "undefined") module.exports = { blocks, inline }; // 테스트용
  else main();
})();
