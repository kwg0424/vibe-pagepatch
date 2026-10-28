// XML 주소를 직접 열면 들여쓰기 · 색 · 접기로 보여 준다 (RSS · Atom · sitemap 포함). 틀은 viewer-common.js.
// 응답 형식이 XML 이면 브라우저가 자기 트리 화면(#webkit-xml-viewer-source-xml)을 만들기 때문에 그 안의 원본을 꺼내 쓴다.
// text/plain 으로 오는 .xml 은 다른 텍스트 파일처럼 <pre> 하나이다.

(() => {
  const el = (...args) => globalThis.PPView.el(...args);

  const label = (cls, text) => {
    const e = el("span", cls);
    e.dataset.s = text;
    return e;
  };

  const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escAttr = (s) => escText(s).replace(/"/g, "&quot;");

  // DOM → { t: "el" | "tx" | "cd" | "cm" | "pi", ... } (공백뿐인 글은 버림)
  function model(n) {
    switch (n.nodeType) {
      case 1:
        return {
          t: "el",
          name: n.nodeName,
          attrs: [...n.attributes].map((a) => [a.name, a.value]),
          kids: [...n.childNodes].map(model).filter(Boolean),
        };
      case 3: {
        const v = n.nodeValue.trim();
        return v ? { t: "tx", v } : null;
      }
      case 4:
        return { t: "cd", v: n.nodeValue };
      case 8:
        return { t: "cm", v: n.nodeValue };
      case 7:
        return { t: "pi", v: `${n.target} ${n.data}`.trim() };
      default:
        return null;
    }
  }

  const openTag = (m, self) => `<${m.name}${m.attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("")}${self ? "/" : ""}>`;
  const textOnly = (m) => m.kids.length === 1 && m.kids[0].t === "tx";

  // 복사용 글 (정리 상태)
  function pretty(m, pad = "") {
    if (m.t === "tx") return pad + escText(m.v);
    if (m.t === "cd") return `${pad}<![CDATA[${m.v}]]>`;
    if (m.t === "cm") return `${pad}<!--${m.v}-->`;
    if (m.t === "pi") return `${pad}<?${m.v}?>`;
    if (!m.kids.length) return pad + openTag(m, true);
    if (textOnly(m)) return `${pad}${openTag(m)}${escText(m.kids[0].v)}</${m.name}>`;
    return `${pad}${openTag(m)}\n${m.kids.map((k) => pretty(k, pad + "  ")).join("\n")}\n${pad}</${m.name}>`;
  }

  // 화면
  const tag = (m, self) => {
    const out = el("span", "p");
    out.append("<", el("span", "tg", m.name));
    for (const [k, v] of m.attrs) out.append(" ", el("span", "at", k), "=", el("span", "s", `"${v}"`));
    out.append(self ? "/>" : ">");
    return out;
  };

  // 닫는 태그도 여는 태그처럼 이름에 색을 입힌다
  const closeTag = (m) => {
    const out = el("span", "p");
    out.append("</", el("span", "tg", m.name), ">");
    return out;
  };

  function render(m) {
    const row = el("div", "r");
    if (m.t === "tx") row.append(el("span", "tx", m.v));
    else if (m.t === "cm") row.append(el("span", "cm", `<!--${m.v}-->`));
    else if (m.t === "cd") row.append(el("span", "s", `<![CDATA[${m.v}]]>`));
    else if (m.t === "pi") row.append(el("span", "kw", `<?${m.v}?>`));
    else if (!m.kids.length) row.append(tag(m, true));
    else if (textOnly(m)) row.append(tag(m), el("span", "tx", m.kids[0].v), closeTag(m));
    else {
      row.classList.add("n");
      row.append(el("span", "t", "▾"), tag(m), label("sum", ` ${m.kids.length}개 요소 `));
      const ch = el("div", "ch");
      m.kids.forEach((k) => ch.append(render(k)));
      if (ch.querySelector(".n")) {
        const group = el("span", "sub");
        const close = label("", "−");
        close.dataset.act = "close";
        close.title = "안쪽 칸 모두 닫기";
        const open = label("", "+");
        open.dataset.act = "open";
        open.title = "안쪽 칸 모두 열기";
        group.append(close, open);
        row.append(group);
      }
      row.append(ch, closeTag(m));
    }
    return row;
  }

  const CSS = `
    #pp-view { padding-left: calc(var(--pp-fs, 13px) * 2.5); }
    #pp-view .r { position: relative; }
    #pp-view .ch { margin-left: 1.6em; }
    #pp-view .t { position: absolute; left: -1.6em; width: 1.4em; text-align: center; font-size: 1.3em; line-height: 1.2; color: #7f8794; cursor: pointer; user-select: none; }
    #pp-view .t:hover { color: #e6e6e6; }
    #pp-view .p { color: #abb2bf; } #pp-view .tg { color: #e06c75; } #pp-view .at { color: #d19a66; } #pp-view .s { color: #98c379; }
    #pp-view .tx { color: #e6e6e6; } #pp-view .cm { color: #5c6370; font-style: italic; } #pp-view .kw { color: #c678dd; }
    #pp-view .sub { display: inline-flex; margin-left: 8px; vertical-align: baseline; user-select: none; }
    #pp-view .sub > span { min-width: 14px; padding: 0 2px; text-align: center; color: #7f8794; font: 12px/1.5 "Segoe UI", "Malgun Gothic", sans-serif; border: 1px solid #3e4451; cursor: pointer; }
    #pp-view .sub > span + span { margin-left: -1px; border-radius: 0 4px 4px 0; } #pp-view .sub > span:first-child { border-radius: 4px 0 0 4px; }
    #pp-view .sub > span:hover { color: #e6e6e6; background: #2c313a; }
    #pp-view .n.c > .sub { display: none; }
    #pp-view .sum::before, #pp-view .sub > span::before { content: attr(data-s); }
    #pp-view .sum { display: none; color: #5c6370; font-style: italic; cursor: pointer; user-select: none; }
    #pp-view .sum:hover { color: #abb2bf; }
    #pp-view .n.c > .ch { display: none; } #pp-view .n.c > .sum { display: inline; }
    #pp-view .n.c > .t { transform: rotate(-90deg); }
    body > :not(#pp-bar):not(#pp-view):not(.pp-raw) { display: none !important; } /* 브라우저 기본 XML 트리 화면은 가림 */
  `;

  function buildView(models) {
    const view = el("div");
    models.forEach((m) => view.append(render(m)));
    // 접힌 칸이 선택 범위에 있어도 안쪽 내용까지 복사
    view.addEventListener("copy", (e) => {
      const sel = getSelection();
      const closed = [...view.querySelectorAll(".n.c")];
      if (sel.isCollapsed || !closed.length) return;
      closed.forEach((c) => c.classList.remove("c"));
      const text = sel.toString();
      closed.forEach((c) => c.classList.add("c"));
      e.clipboardData.setData("text/plain", text);
      e.preventDefault();
    });
    view.addEventListener("click", (e) => {
      const t = e.target.closest(".t");
      if (t) t.parentElement.classList.toggle("c");
      const sum = e.target.closest(".sum");
      if (sum) sum.parentElement.classList.remove("c");
      const act = e.target.closest(".sub > span");
      if (act) act.closest(".n").querySelectorAll(".n").forEach((c) => c.classList.toggle("c", act.dataset.act === "close"));
    });
    return view;
  }

  // 글 → { models, decl } (문법 오류면 Error)
  function read(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const err = doc.querySelector("parsererror");
    if (err) throw new Error((err.textContent.split("\n").find((l) => l.trim()) || "문법 오류").trim().slice(0, 120));
    const models = [];
    const decl = /^\s*<\?xml[^?]*\?>/.exec(text)?.[0].trim();
    if (decl) models.push({ t: "pi", v: decl.slice(2, -2) });
    for (const n of doc.childNodes) {
      const m = model(n);
      if (m) models.push(m);
    }
    return models;
  }

  // 브라우저의 XML 트리 화면에서 원본 글을 꺼낸다
  function sourceOfViewer() {
    const src = document.getElementById("webkit-xml-viewer-source-xml");
    if (!src) return null;
    return [...src.childNodes].map((n) => new XMLSerializer().serializeToString(n)).join("");
  }

  const XML_TYPE = /^(application|text)\/([\w.-]+\+)?xml$/i;
  const EXTS = new Set(["xml", "rss", "atom", "xsd", "xsl", "xslt", "sitemap"]);

  function start(P, pre, text) {
    pre.classList.add("pp-raw"); // 브라우저 XML 화면을 가리는 규칙에서 제외
    P.enabled("xml").then((on) => {
      if (!on) return;
      const big = P.isBig(text);
      let models; // 큰 파일은 정리하기를 눌렀을 때 처음 읽는다
      const get = () => (models ??= read(text));
      if (!big) {
        try {
          get();
        } catch (e) {
          return P.notice(pre, `XML 문법 오류라서 원본 그대로 둡니다: ${e.message}`);
        }
      }
      P.mount({
        pre,
        ext: "XML",
        css: CSS,
        startRaw: big,
        note: big ? P.bigNote(text) : "",
        build: () => {
          try {
            return buildView(get());
          } catch (e) {
            throw new Error(`XML 문법 오류라서 정리하지 못했습니다: ${e.message}`);
          }
        },
        // 내용 복사: 원본 상태는 태그 사이 공백 없이 한 줄, 정리 상태는 들여쓴 글 (읽을 수 없으면 원문)
        copy: (raw) => {
          if (raw) return text.replace(/>\s+</g, "><").trim();
          try {
            return get().map((m) => (m.t === "pi" && /^xml/.test(m.v) ? `<?${m.v}?>` : pretty(m))).join("\n");
          } catch {
            return text;
          }
        },
      });
    });
  }

  function main() {
    const P = globalThis.PPView;
    if (!P) return;
    const ct = document.contentType || "";
    if (/xhtml|svg/i.test(ct)) return;
    const page = P.plainText();
    if (page) {
      if (XML_TYPE.test(ct) || (ct === "text/plain" && EXTS.has(P.fileExt()))) start(P, page.pre, page.text);
      return;
    }
    if (!XML_TYPE.test(ct)) return;
    const text = sourceOfViewer(); // 브라우저가 XML 트리 화면을 만든 경우
    if (text === null) return;
    const pre = el("pre", "pp-raw");
    pre.textContent = text;
    document.body.append(pre);
    start(P, pre, text);
  }

  if (typeof module !== "undefined") module.exports = { read, pretty }; // 테스트용
  else main();
})();
