// CSS 문자열 처리. 문자열·주석·괄호(url(...)) 안은 건드리지 않는다.

// 자동 !important: 선언 끝에 !important 를 붙인다.
// @keyframes · @font-face · @page 안은 붙이면 선언이 무시되므로 건너뛴다. 사용자 변수(--x)도 그대로 둔다.
const SKIP_AT = /^@(-[a-z]+-)?(keyframes|font-face|page|property|counter-style|font-feature-values)\b/i;

export function addImportant(css) {
  let out = "";
  let buf = "";
  const stack = []; // 블록마다 건너뛸지 여부
  const skipping = () => stack.some(Boolean);
  const flushDecl = () => {
    if (stack.length && !skipping() && /^\s*[a-z-]+\s*:/i.test(buf) && !/^\s*--/.test(buf) && !/!\s*important\s*$/i.test(buf) && buf.trim()) {
      const trail = buf.match(/\s*$/)[0];
      buf = `${buf.slice(0, buf.length - trail.length)} !important${trail}`;
    }
    out += buf;
    buf = "";
  };
  let i = 0;
  let paren = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? css.length : end + 2;
      // 주석은 선언 텍스트에 섞지 않고 따로 보낸다 (주석 뒤에 !important 가 붙지 않게)
      if (buf.trim()) buf += css.slice(i, stop);
      else {
        out += buf + css.slice(i, stop);
        buf = "";
      }
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      buf += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "(") paren++;
    else if (c === ")" && paren > 0) paren--;
    if (paren === 0 && c === "{") {
      stack.push(SKIP_AT.test(buf.trim()));
      out += `${buf}{`;
      buf = "";
    } else if (paren === 0 && c === "}") {
      flushDecl();
      stack.pop();
      out += "}";
    } else if (paren === 0 && c === ";") {
      flushDecl();
      out += ";";
    } else buf += c;
    i++;
  }
  out += buf;
  return out;
}

// 한 줄 주석(// …, SCSS 문법) → /* … */. http:// 같은 주소와 문자열 안은 그대로 둔다
export function lineCommentsToBlock(css) {
  let out = "";
  let i = 0;
  let paren = 0;
  let changed = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? css.length : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "(") paren++;
    else if (c === ")" && paren > 0) paren--;
    if (c === "/" && css[i + 1] === "/" && paren === 0 && css[i - 1] !== ":") {
      const end = css.indexOf("\n", i);
      const stop = end < 0 ? css.length : end;
      const text = css.slice(i + 2, stop).replace(/\r$/, "");
      out += `/*${text.replace(/\*\//g, "* /")} */${css.slice(i + 2 + text.length, stop)}`;
      changed++;
      i = stop;
      continue;
    }
    out += c;
    i++;
  }
  return { css: out, changed };
}
