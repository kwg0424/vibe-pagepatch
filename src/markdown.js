// AI 규칙(notes) 미리보기용 작은 마크다운 → HTML.
// 모든 글자를 먼저 이스케이프하고 정해진 태그만 만든다 (규칙은 동기화로 다른 곳에서 올 수 있으므로 HTML 은 그대로 넣지 않는다).
// 지원: 제목(#), 목록(-, *, +, 1.) · 들여쓰기 중첩 · 체크박스([ ], [x]), 인용(>), 코드 블록(```), 구분선(---), 표(|),
//       인라인 `코드` · **굵게** · *기울임* · ~~취소선~~ · [링크](http…)

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const indentOf = (line) => line.match(/^ */)[0].length;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

// lines[i] 부터 같은 들여쓰기의 목록 → [html, 다음 줄 번호]
function list(lines, i) {
  const base = indentOf(lines[i]);
  const ordered = /^\d/.test(LIST.exec(lines[i])[2]);
  let html = ordered ? "<ol>" : "<ul>";
  while (i < lines.length) {
    const m = LIST.exec(lines[i]);
    if (!m || indentOf(lines[i]) !== base || /^\d/.test(m[2]) !== ordered) break; // 다른 종류 목록이면 새 목록
    let body = m[3];
    let cls = "";
    const task = /^\[([ xX])\]\s+(.*)$/.exec(body);
    if (task) {
      cls = ' class="task"';
      body = `<input type="checkbox" disabled${task[1] === " " ? "" : " checked"}> ${inline(task[2])}`;
    } else body = inline(body);
    i++;
    // 이어지는 들여쓴 줄: 하위 목록 또는 같은 항목의 다음 줄
    while (i < lines.length && lines[i].trim() && indentOf(lines[i]) > base) {
      if (LIST.test(lines[i])) {
        const [sub, next] = list(lines, i);
        body += sub;
        i = next;
      } else body += `<br>${inline(lines[i++].trim())}`;
    }
    html += `<li${cls}>${body}</li>`;
  }
  return [html + (ordered ? "</ol>" : "</ul>"), i];
}

export function renderMarkdown(src) {
  const lines = String(src || "").replace(/\r\n?/g, "\n").replace(/\t/g, "  ").split("\n");
  let html = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      i++;
      html += `<pre><code>${esc(code.join("\n"))}</code></pre>`;
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      html += "<hr>";
      i++;
      continue;
    }
    if (LIST.test(line)) {
      const [out, next] = list(lines, i);
      html += out;
      i = next;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      html += `<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      let body = "";
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) body += `<tr>${cells(lines[i++]).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`;
      html += `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
      continue;
    }
    // 문단: 빈 줄이나 다른 블록이 나올 때까지
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) && !LIST.test(lines[i])) para.push(inline(lines[i++].trim()));
    html += `<p>${para.join("<br>")}</p>`;
  }
  return html;
}
