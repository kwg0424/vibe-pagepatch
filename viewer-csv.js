// CSV · TSV 주소를 직접 열면 표로 보여 준다 (첫 줄은 머리글, 행 번호). 틀은 viewer-common.js.
// 브라우저가 파일로 내려받는 응답(Content-Disposition 등)은 화면에 열리지 않으므로 대상이 아니다.

(() => {
  // RFC 4180: 따옴표 안의 구분자 · 줄바꿈, "" 는 따옴표 하나
  function parse(text, delim) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; // BOM
    for (; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c !== '"') cell += c;
        else if (text[i + 1] === '"') (cell += '"'), i++;
        else quoted = false;
      } else if (c === '"' && !cell) quoted = true;
      else if (c === delim) (row.push(cell), (cell = ""));
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else cell += c;
    }
    if (cell || row.length) (row.push(cell), rows.push(row));
    return rows;
  }

  // 표 → 탭으로 구분한 글 (엑셀 붙여넣기용). 탭 · 줄바꿈 · 따옴표가 든 칸은 따옴표로 감싼다
  function toTsv(rows) {
    const q = (v) => (/[\t\r\n"]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
    return rows.map((r) => r.map(q).join("\t")).join("\n");
  }

  const CSS = `
    #pp-view { padding: 0; font-size: var(--pp-fs, 13px); }
    #pp-view table { border-collapse: separate; border-spacing: 0; width: 100%; counter-reset: r; }
    #pp-view th, #pp-view td { padding: 4px 12px; border-right: 1px solid #454b58; border-bottom: 1px solid #454b58; vertical-align: top; text-align: left; word-break: break-word; }
    #pp-view th { position: sticky; top: 33px; z-index: 1; background: #21252b; color: #e6e6e6; font-weight: 600; }
    #pp-view tbody tr { counter-increment: r; }
    #pp-view tbody tr:nth-child(even) td { background: rgba(255, 255, 255, .03); }
    #pp-view tbody tr:hover td { background: rgba(97, 175, 239, .1); }
    #pp-view .no { width: 1%; min-width: 3em; text-align: right; color: #5c6370; user-select: none; white-space: nowrap; }
    #pp-view tbody .no::before { content: counter(r); } /* 행 번호는 CSS 로 그려서 드래그 · 복사에 잡히지 않음 */
    #pp-view th:last-child, #pp-view td:last-child { border-right: 0; }
    #pp-view tbody tr:last-child td { border-bottom: 0; }
  `;

  function buildTable(rows) {
    const { el } = globalThis.PPView;
    const cols = Math.max(...rows.map((r) => r.length));
    const table = el("table");
    const fill = (tr, r, tag) => {
      for (let k = 0; k < cols; k++) tr.append(el(tag, "", r[k] ?? ""));
    };
    // 첫 줄이 머리글인지: 숫자 · 날짜처럼 보이는 칸이 하나라도 있으면 데이터로 보고 칸 번호(1, 2, 3…)를 머리글로 쓴다
    const dataLike = (c) => /^[\d\s.,:/+-]+$/.test(c.trim());
    const hasHeader = rows.length > 1 && rows[0].every((c) => c.trim() && !dataLike(c));
    const head = el("tr");
    head.append(el("th", "no", "#"));
    fill(head, hasHeader ? rows[0] : Array.from({ length: cols }, (_, k) => String(k + 1)), "th");
    const thead = el("thead");
    thead.append(head);
    table.append(thead);
    const body = el("tbody");
    for (const r of hasHeader ? rows.slice(1) : rows) {
      const tr = el("tr");
      tr.append(el("td", "no"));
      fill(tr, r, "td");
      body.append(tr);
    }
    table.append(body);
    const view = el("div");
    view.append(table);
    return view;
  }

  // 구분자: 확장자 · 응답 형식이 정한 것을 먼저 쓰되, 첫 줄에 그 글자가 없으면 쉼표 · 탭 · 세미콜론 중 가장 많은 것을 쓴다
  // (예: .tsv 인데 안의 내용은 쉼표로 나뉜 파일)
  function pickDelimiter(text, preferred) {
    const first = text.split("\n", 1)[0];
    const count = (d) => first.split(d).length - 1;
    if (count(preferred)) return preferred;
    const [best, n] = [",", "\t", ";"].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0];
    return n ? best : preferred;
  }

  function main() {
    const P = globalThis.PPView;
    const page = P?.plainText();
    if (!page) return;
    const { pre, text, ct } = page;
    const ext = P.fileExt();
    const tsv = /tab-separated/i.test(ct) || (ct === "text/plain" && ext === "tsv");
    const csv = /^text\/(csv|comma-separated-values)$/i.test(ct) || (ct === "text/plain" && ext === "csv");
    if (!tsv && !csv) return;
    P.enabled("csv").then((on) => {
      if (!on) return;
      const big = P.isBig(text);
      let rows; // 큰 파일은 정리하기를 눌렀을 때 처음 읽는다
      const delim = pickDelimiter(text, tsv ? "\t" : ",");
      const get = () => (rows ??= parse(text, delim));
      if (!big && !get().length) return;
      P.mount({
        pre,
        ext: delim === "\t" ? "TSV" : "CSV", // 실제 구분자로 윗줄에 표시
        css: CSS,
        startRaw: big,
        note: big ? P.bigNote(text) : "",
        build: () => buildTable(get()),
        // 내용 복사: 원본 상태는 원문 그대로, 표 상태는 탭으로 구분한 글
        copy: (raw) => (raw ? text : toTsv(get())),
        prettyLabel: "표로 보기",
      });
    });
  }

  if (typeof module !== "undefined") module.exports = { parse, toTsv }; // 테스트용
  else main();
})();
