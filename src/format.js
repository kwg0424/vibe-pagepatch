// 데이터 비교: 붙여 넣은 글을 보기 좋게 정리한다 (JSON · XML). 정리 못 하는 형식이면 이유를 돌려준다.
// → { ok: true, kind: "JSON" | "XML", text } | { ok: false, reason }

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

// XML 요소를 2칸 들여쓰기로 다시 쓴다. 글자만 든 요소는 한 줄로, 공백뿐인 글은 버린다
function writeXml(node, depth, out) {
  const pad = "  ".repeat(depth);
  switch (node.nodeType) {
    case 1: {
      const attrs = [...node.attributes].map((a) => ` ${a.name}="${escAttr(a.value)}"`).join("");
      const kids = [...node.childNodes].filter((n) => !(n.nodeType === 3 && !n.nodeValue.trim()));
      if (!kids.length) out.push(`${pad}<${node.nodeName}${attrs}/>`);
      else if (kids.every((n) => n.nodeType === 3 || n.nodeType === 4)) {
        out.push(`${pad}<${node.nodeName}${attrs}>${kids.map((n) => (n.nodeType === 4 ? `<![CDATA[${n.nodeValue}]]>` : esc(n.nodeValue.trim()))).join("")}</${node.nodeName}>`);
      } else {
        out.push(`${pad}<${node.nodeName}${attrs}>`);
        for (const k of kids) writeXml(k, depth + 1, out);
        out.push(`${pad}</${node.nodeName}>`);
      }
      return;
    }
    case 3:
      if (node.nodeValue.trim()) out.push(pad + esc(node.nodeValue.trim()));
      return;
    case 4:
      out.push(`${pad}<![CDATA[${node.nodeValue}]]>`);
      return;
    case 7:
      out.push(`${pad}<?${node.target} ${node.data}?>`);
      return;
    case 8:
      out.push(`${pad}<!--${node.nodeValue}-->`);
      return;
  }
}

// parseXml: 글 → XML 문서 (기본은 브라우저의 DOMParser. 시험할 때 바꿔 끼운다)
export function formatText(text, parseXml = (t) => new DOMParser().parseFromString(t, "application/xml")) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, reason: "정리할 내용이 없습니다" };
  const c = t[0];
  if (c === "{" || c === "[") {
    try {
      return { ok: true, kind: "JSON", text: JSON.stringify(JSON.parse(t), null, 2) };
    } catch (e) {
      return { ok: false, reason: `JSON 이 올바르지 않습니다 (${e.message})` };
    }
  }
  if (c === "<") {
    const doc = parseXml(t);
    const bad = doc.querySelector?.("parsererror");
    if (bad || !doc.documentElement) return { ok: false, reason: "XML 이 올바르지 않습니다" };
    const out = [];
    const decl = /^<\?xml[\s\S]*?\?>/.exec(t);
    if (decl) out.push(decl[0]); // 맨 앞 <?xml ...?> 는 그대로
    for (const n of doc.childNodes) writeXml(n, 0, out);
    return { ok: true, kind: "XML", text: out.join("\n") };
  }
  return { ok: false, reason: "정리할 수 있는 형식이 아닙니다 (JSON · XML)" };
}
