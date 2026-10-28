// JSON 주소를 직접 열면 읽기 좋게 보여 준다 (들여쓰기 · One Dark 색 · 접기 · 원본 전환).
// 응답 형식이 JSON 인 페이지(브라우저가 <pre> 한 개로 보여 주는 것)에만 동작한다. 일반 웹페이지는 건드리지 않는다.
// 큰 숫자(예: 19자리 id)가 깎이지 않도록 JSON.parse 대신 원문 그대로 읽는 작은 파서를 쓴다.

(() => {
  // ── 파서: 문자열 → { t: "o"|"a"|"s"|"n"|"l", ... }. 문법이 틀리면 Error
  function parse(text) {
    let i = 0;
    const err = (msg) => {
      const upTo = text.slice(0, i);
      const line = upTo.split("\n").length;
      throw new Error(`${msg} (${line}번째 줄)`);
    };
    const ws = () => {
      while (i < text.length && " \t\r\n".includes(text[i])) i++;
    };
    const str = () => {
      const start = i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      if (i >= text.length) err("문자열이 닫히지 않았습니다");
      i++;
      try {
        return JSON.parse(text.slice(start, i));
      } catch {
        err("문자열이 올바르지 않습니다");
      }
    };
    const value = () => {
      ws();
      const c = text[i];
      if (c === "{") {
        i++;
        const entries = [];
        ws();
        if (text[i] === "}") return i++, { t: "o", entries };
        for (;;) {
          ws();
          if (text[i] !== '"') err("키는 큰따옴표 문자열이어야 합니다");
          const key = str();
          ws();
          if (text[i++] !== ":") err("':' 가 필요합니다");
          entries.push([key, value()]);
          ws();
          if (text[i] === ",") i++;
          else if (text[i] === "}") return i++, { t: "o", entries };
          else err("',' 또는 '}' 가 필요합니다");
        }
      }
      if (c === "[") {
        i++;
        const items = [];
        ws();
        if (text[i] === "]") return i++, { t: "a", items };
        for (;;) {
          items.push(value());
          ws();
          if (text[i] === ",") i++;
          else if (text[i] === "]") return i++, { t: "a", items };
          else err("',' 또는 ']' 가 필요합니다");
        }
      }
      if (c === '"') return { t: "s", v: str() };
      const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 400));
      if (!m) err("올바르지 않은 값입니다");
      i += m[0].length;
      return { t: m[0] === "true" || m[0] === "false" ? "b" : m[0] === "null" ? "l" : "n", v: m[0] };
    };
    const root = value();
    ws();
    if (i < text.length) err("끝에 남는 내용이 있습니다");
    return root;
  }

  // ── 복사용 글: 노드 → 문자열 (큰 숫자는 원문 그대로)
  function stringify(node, indent) {
    const walk = (n, pad) => {
      if (n.t === "s") return JSON.stringify(n.v);
      if (n.t !== "o" && n.t !== "a") return n.v;
      const isObj = n.t === "o";
      const list = isObj ? n.entries : n.items;
      const [open, close] = isObj ? ["{", "}"] : ["[", "]"];
      if (!list.length) return open + close;
      const inner = pad + indent;
      const parts = list.map((x) => (isObj ? JSON.stringify(x[0]) + (indent ? ": " : ":") + walk(x[1], inner) : walk(x, inner)));
      return indent ? `${open}
${inner}${parts.join(`,
${inner}`)}
${pad}${close}` : open + parts.join(",") + close;
    };
    return walk(node, "");
  }

  // ── 화면: 노드 → DOM (공통 도우미는 viewer-common.js)
  const el = (...args) => globalThis.PPView.el(...args);

  const label = (cls, text) => {
    const e = el("span", cls);
    e.dataset.s = text;
    return e;
  };

  // 안쪽 칸을 한 번에 접기(−) · 펴기(+). 글자는 CSS 로 그려서 드래그에 잡히지 않음
  function subButtons() {
    const group = el("span", "sub");
    const close = label("", "−");
    close.dataset.act = "close";
    close.title = "안쪽 칸 모두 닫기";
    const open = label("", "+");
    open.dataset.act = "open";
    open.title = "안쪽 칸 모두 열기";
    group.append(close, open);
    return group;
  }

  function render(node, comma) {
    const row = el("div", "r");
    if (node.t === "o" || node.t === "a") {
      const isObj = node.t === "o";
      const list = isObj ? node.entries : node.items;
      const [open, close] = isObj ? ["{", "}"] : ["[", "]"];
      row.append(el("span", "p", open));
      if (!list.length) {
        row.append(el("span", "p", close));
      } else {
        row.classList.add("n");
        const toggle = el("span", "t", "▾");
        row.prepend(toggle);
        row.append(label("sum", ` ${list.length}${isObj ? "개 키" : "개 항목"} `)); // 글자는 CSS 로 그려서 드래그 · 복사에 잡히지 않음
        const ch = el("div", "ch");
        list.forEach((x, k) => {
          const child = isObj ? render(x[1], k < list.length - 1) : render(x, k < list.length - 1);
          if (isObj) child.prepend(el("span", "k", JSON.stringify(x[0])), el("span", "p", ": "));
          ch.append(child);
        });
        if (ch.querySelector(".n")) row.append(subButtons()); // 안에 접을 수 있는 칸이 있을 때만
        row.append(ch, el("span", "p", close));
      }
    } else {
      const cls = { s: "s", n: "n2", b: "bo", l: "b" }[node.t];
      const span = el("span", cls);
      if (node.t === "s" && /^https?:\/\/\S+$/i.test(node.v)) { // 주소는 링크로 (새 창)
        const a = el("a", "", node.v);
        a.href = node.v;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        span.append('"', a, '"');
      } else span.textContent = node.t === "s" ? JSON.stringify(node.v) : node.v;
      row.append(span);
    }
    if (comma) row.append(el("span", "p", ","));
    return row;
  }

  // JSON 보기에만 쓰는 스타일 (윗줄 · 카드 틀은 viewer-common.js)
  const CSS = `
    #pp-view { padding-left: calc(var(--pp-fs, 13px) * 2.5); }
    #pp-view .r { position: relative; }
    #pp-view .ch { margin-left: 1.6em; }
    #pp-view .t { position: absolute; left: -1.6em; width: 1.4em; text-align: center; font-size: 1.3em; line-height: 1.2; color: #7f8794; cursor: pointer; user-select: none; }
    #pp-view .t:hover { color: #e6e6e6; }
    #pp-view .k { color: #e06c75; } #pp-view .s { color: #98c379; } #pp-view .n2 { color: #d19a66; }
    #pp-view .b { color: #56b6c2; } #pp-view .bo { color: #c678dd; } #pp-view .p { color: #abb2bf; }
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
  `;

  // 보기 요소 (루트 노드 → DOM)
  function buildView(root) {
    const view = el("div");
    view.append(render(root, false));
    // 접힌 칸이 선택 범위에 있어도 안쪽 내용까지 복사: 복사하는 순간만 모두 펼쳐서 선택 글자를 만든다
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
      const sum = e.target.closest(".sum"); // 접힌 모양 ({ 33개 키 }) 을 눌러도 펼침
      if (sum) sum.parentElement.classList.remove("c");
      const act = e.target.closest(".sub > span");
      if (act) act.closest(".n").querySelectorAll(".n").forEach((c) => c.classList.toggle("c", act.dataset.act === "close")); // 이 칸은 두고 그 아래 칸만 모두 접거나 폄
    });
    return view;
  }

  function main() {
    const P = globalThis.PPView;
    const page = P?.plainText();
    if (!page) return;
    const { pre, text, ct } = page;
    const jsonType = /(^|\/|\+)json$/i.test(ct);
    if (!jsonType && !(ct === "text/plain" && /^\s*[[{]/.test(text))) return;
    P.enabled("json").then((on) => {
      const big = P.isBig(text);
      if (!on || (big && !jsonType)) return;
      let root; // 큰 파일은 정리하기를 눌렀을 때 처음 읽는다
      const get = () => (root ??= parse(text));
      if (!big) {
        try {
          get();
        } catch (e) {
          if (ct === "text/plain") return; // JSON 이 아닌 일반 텍스트
          return P.notice(pre, `JSON 문법 오류라서 원본 그대로 둡니다: ${e.message}`);
        }
      }
      P.mount({
        pre,
        ext: "JSON",
        css: CSS,
        startRaw: big,
        note: big ? P.bigNote(text) : "",
        build: () => {
          try {
            return buildView(get());
          } catch (e) {
            throw new Error(`JSON 문법 오류라서 정리하지 못했습니다: ${e.message}`);
          }
        },
        // 내용 복사: 원본 상태는 줄바꿈 · 여백 없이, 정리 상태는 보이는 모양 그대로 (읽을 수 없으면 원문)
        copy: (raw) => {
          try {
            return stringify(get(), raw ? "" : "  ");
          } catch {
            return text;
          }
        },
      });
    });
  }

  if (typeof module !== "undefined") module.exports = { parse, stringify }; // 테스트용
  else main();
})();
