// JS · CSS 주소를 직접 열면 줄 번호와 색을 입혀 보여 준다 (코드 정리나 접기는 없음). 틀은 viewer-common.js.
// 정규식 리터럴은 나눗셈과 구분하기 어려워 따로 칠하지 않는다.

(() => {
  const KEYWORDS = new Set(
    "as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch throw try typeof var void while with yield".split(" ")
  );
  const LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);

  // ── JS: [분류, 글자] 목록. 분류: kw(키워드) s(문자열) n(숫자) c(주석) f(함수 이름) lit(true/false/null) t(this) 그 밖은 ""
  const JS_RE = {
    ws: /\s+/y,
    comment: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y,
    str: /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/y,
    tpl: /`(?:\\[\s\S]|[^`\\])*`?/y,
    num: /0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?n?|\.\d+/y,
    id: /[A-Za-z_$][\w$]*/y,
  };

  function scan(src, i, re) {
    re.lastIndex = i;
    const m = re.exec(src);
    return m && m.index === i && m[0] ? m[0] : null;
  }

  function highlightJs(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      let t;
      if ((t = scan(src, i, JS_RE.ws))) out.push(["", t]);
      else if ((t = scan(src, i, JS_RE.comment))) out.push(["c", t]);
      else if ((t = scan(src, i, JS_RE.str)) || (t = scan(src, i, JS_RE.tpl))) out.push(["s", t]);
      else if ((t = scan(src, i, JS_RE.num))) out.push(["n", t]);
      else if ((t = scan(src, i, JS_RE.id))) {
        const cls = KEYWORDS.has(t) ? "kw" : LITERALS.has(t) ? "lit" : t === "this" ? "t" : src[i + t.length] === "(" ? "f" : "";
        out.push([cls, t]);
      } else out.push(["", (t = src[i])]);
      i += t.length;
    }
    return out;
  }

  // ── CSS
  function highlightCss(src) {
    const out = [];
    const n = src.length;
    let i = 0;
    const P = (cls, t) => {
      out.push([cls, t]);
      i += t.length;
    };
    const strEnd = (j) => {
      const q = src[j];
      for (j++; j < n && src[j] !== q && src[j] !== "\n"; j++) if (src[j] === "\\") j++;
      return Math.min(j + 1, n);
    };
    // 이 문장이 { 로 끝나면 선택자 (; 나 } 로 끝나면 속성)
    const selectorAhead = (from) => {
      let paren = 0;
      for (let j = from; j < n; j++) {
        const c = src[j];
        if (c === "/" && src[j + 1] === "*") {
          const e = src.indexOf("*/", j + 2);
          if (e < 0) return false;
          j = e + 1;
        } else if (c === '"' || c === "'") j = strEnd(j) - 1;
        else if (c === "(") paren++;
        else if (c === ")") paren--;
        else if (paren <= 0) {
          if (c === "{") return true;
          if (c === ";" || c === "}") return false;
        }
      }
      return false;
    };
    const tokens = (list) => {
      for (const [cls, re] of list) {
        const t = scan(src, i, re);
        if (t) return P(cls, t), true;
      }
      return false;
    };
    const COMMENT = ["c", /\/\*[\s\S]*?(?:\*\/|$)/y];
    const STR = ["s", /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/y];
    const SEL = [COMMENT, STR, ["n", /\[[^\]]*\]/y], ["cl", /[.#][\w-]+/y], ["f", /::?[\w-]+(?:\([^)]*\))?/y], ["tag", /[A-Za-z][\w-]*|\*/y]];
    const VAL = [COMMENT, STR, ["kw", /!\s*important/iy], ["n", /#[\da-fA-F]{3,8}\b/y], ["n", /-?(?:\d*\.)?\d+[a-zA-Z%]*/y], ["f", /[\w-]+(?=\()/y]];
    while (i < n) {
      if (scan(src, i, /\s+/y)) P("", scan(src, i, /\s+/y));
      else if (tokens([COMMENT])) continue;
      else if (src[i] === "{" || src[i] === "}" || src[i] === ";") P("", src[i]);
      else if (src[i] === "@") {
        P("kw", scan(src, i, /@[\w-]*/y));
        while (i < n && src[i] !== "{" && src[i] !== ";") if (!tokens([COMMENT, STR, ["n", /-?(?:\d*\.)?\d+[a-zA-Z%]*/y]])) P("", src[i]);
      } else if (selectorAhead(i)) {
        while (i < n && src[i] !== "{") if (!tokens(SEL)) P("", src[i]);
      } else {
        const prop = scan(src, i, /[-\w]+/y);
        if (prop) P("k", prop);
        while (i < n && src[i] !== ";" && src[i] !== "}") if (!tokens(VAL)) P("", src[i]);
        if (!prop && src[i] !== ";" && src[i] !== "}" && i < n) P("", src[i]);
      }
    }
    return out;
  }

  // ── 한 줄로 압축된 파일에 줄바꿈 · 들여쓰기를 넣는다 (가벼운 정리: 줄바꿈과 들여쓰기만, 연산자 모양은 그대로)
  const isMinified = (text) => text.split("\n").some((l) => l.length > 300);

  function format(tokens, lang) {
    const css = lang === "css";
    const out = [];
    let depth = 0;
    let atStart = true; // 줄 맨 앞인지
    const parens = [0]; // { 마다 괄호 깊이를 따로 센다 (for(;;) 의 ; 는 줄바꿈하지 않음)
    const put = (cls, text) => {
      if (atStart) (out.push(["", "  ".repeat(depth)]), (atStart = false));
      out.push([cls, text]);
    };
    const space = () => {
      if (!atStart && out.at(-1)[1] !== " ") out.push(["", " "]);
    };
    const nl = () => {
      while (out.length && out.at(-1)[0] === "" && /^ +$/.test(out.at(-1)[1])) out.pop(); // 줄 끝 공백 제거
      out.push(["", "\n"]);
      atStart = true;
    };
    let hadWs = false;
    const spaced = [];
    for (const [cls, text] of tokens) {
      if (!cls && !text.trim()) hadWs = true;
      else (spaced.push([cls, text, hadWs]), (hadWs = false));
    }
    for (let k = 0; k < spaced.length; k++) {
      const [cls, text, ws] = spaced[k];
      const nx = spaced[k + 1];
      if (ws) space();
      if (cls === "c") {
        put(cls, text);
        if (text.startsWith("//") || css || nx) nl();
      } else if (text === "{") {
        if (!/[=(,:[?&|!+\-*/%<]$/.test(out.at(-1)?.[1] || "")) space(); // 블록 앞은 한 칸 (= 나 ( 뒤의 객체는 붙임)
        put("", "{");
        if (nx?.[1] === "}") { // 빈 블록 {}
          put("", "}");
          k++;
          closed(spaced[k + 1]);
          continue;
        }
        depth++;
        parens.push(0);
        nl();
      } else if (text === "}") {
        depth = Math.max(0, depth - 1);
        if (parens.length > 1) parens.pop();
        if (!atStart) nl();
        put("", "}");
        closed(nx);
      } else if (text === ";" && parens.at(-1) === 0) {
        put("", ";");
        nl();
      } else if (text === "(") {
        parens[parens.length - 1]++;
        put(cls, text);
      } else if (text === ")") {
        parens[parens.length - 1] = Math.max(0, parens.at(-1) - 1);
        put(cls, text);
      } else if (text === "," || (css && text === ":" && out.at(-1)?.[0] === "k")) {
        put(cls, text);
        if (nx && (!css || parens.at(-1) === 0)) space(); // CSS 는 url( ) 안의 쉼표에는 공백을 넣지 않음
      } else {
        put(cls, text);
        if (cls === "kw" && nx && !nx[2] && !/^[;,.)]$/.test(nx[1])) space(); // if( → if (, return[ → return [
      }
    }
    // } 뒤: JS 는 ) , ; . ] else catch finally while 이 이어지면 같은 줄, 아니면 줄바꿈 (CSS 는 최상위 규칙 사이에 빈 줄)
    function closed(nx) {
      if (!css && nx && (/^[,;).\]]$/.test(nx[1]) || ["else", "catch", "finally", "while"].includes(nx[1]))) return void (/^[a-z]/.test(nx[1]) && out.push(["", " "]));
      nl();
      if (css && depth === 0 && nx) out.push(["", "\n"]);
    }
    while (out.length && out.at(-1)[0] === "" && !out.at(-1)[1].trim()) out.pop();
    return out;
  }

  function main() {
    const P = globalThis.PPView;
    const page = P?.plainText();
    if (!page) return;
    const { pre, text, ct } = page;
    const ext = P.fileExt();
    const plain = ct === "text/plain";
    const js = /^(text|application)\/(x-)?(javascript|ecmascript)$/i.test(ct) || (plain && /^(js|mjs|cjs)$/.test(ext));
    const css = ct === "text/css" || (plain && ext === "css");
    if (!js && !css) return;
    P.enabled("code").then((on) => {
      if (!on) return;
      const lang = css ? "css" : "js";
      const big = P.isBig(text);
      const minified = isMinified(text);
      let tokens; // 큰 파일은 정리하기를 눌렀을 때 처음 만든다
      const get = () => {
        if (!tokens) {
          tokens = lang === "css" ? highlightCss(text) : highlightJs(text);
          if (minified) tokens = format(tokens, lang); // 한 줄로 압축된 파일은 줄바꿈 · 들여쓰기를 넣어 보여 줌
        }
        return tokens;
      };
      P.mount({
        pre,
        ext: css ? "CSS" : "JS",
        css: P.LINE_CSS,
        startRaw: big,
        note: big ? P.bigNote(text) : "",
        build: () => {
          const view = P.el("div");
          view.append(...P.toLines(get()));
          return view;
        },
        // 내용 복사: 원본 상태는 원문 그대로, 정리 상태는 보이는 글 (압축 파일이 아니면 둘 다 원문)
        copy: (raw) => (raw || !minified ? text : get().map((t) => t[1]).join("")),
        prettyLabel: minified ? "정리하기" : "색 입혀 보기",
      });
    });
  }

  if (typeof module !== "undefined") module.exports = { highlightJs, highlightCss, format }; // 테스트용
  else main();
})();
