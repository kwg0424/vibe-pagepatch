// 글 비교 (데이터 비교 탭). 외부 라이브러리 없이 Myers 알고리즘으로 줄 단위 · 글자 단위 차이를 구한다.
// 결과는 "바뀐 덩어리"(hunk) 목록: { a0, a1, b0, b1 } = 왼쪽 a0~a1 줄(끝 제외)이 오른쪽 b0~b1 줄로 바뀜.
//   a0 == a1 이면 오른쪽에만 있는 줄(추가), b0 == b1 이면 왼쪽에만 있는 줄(삭제)

const MAX_D = 1000; // 차이가 이보다 많으면 정밀 비교를 포기하고 가운데 전체를 하나의 덩어리로 (메모리 · 시간 보호)

// A, B: 같은 종류의 값(숫자 · 문자열) 배열 → 바뀐 덩어리 목록 (없으면 [])
function myers(A, B, maxD = MAX_D) {
  const N = A.length;
  const M = B.length;
  if (!N && !M) return [];
  if (!N || !M) return [{ a0: 0, a1: N, b0: 0, b1: M }];
  const max = Math.min(N + M, maxD);
  const off = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) (x++, y++);
      v[off + k] = x;
      if (x >= N && y >= M) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return [{ a0: 0, a1: N, b0: 0, b1: M }]; // 너무 다름: 통째로 바뀐 것으로

  // 되짚어서 편집 목록 (뒤에서부터)
  const ops = [];
  let x = N;
  let y = M;
  for (let d = found; d >= 0; d--) {
    const vv = trace[d];
    const k = x - y;
    if (d === 0) {
      while (x > 0 && y > 0) (ops.push("m"), x--, y--);
      break;
    }
    const prevK = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1]) ? k + 1 : k - 1;
    const prevX = vv[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) (ops.push("m"), x--, y--);
    ops.push(prevK === k + 1 ? "i" : "d"); // k+1 에서 내려옴 = 오른쪽 줄 추가, k-1 에서 옴 = 왼쪽 줄 삭제
    x = prevX;
    y = prevY;
  }
  ops.reverse();

  const hunks = [];
  let i = 0;
  let j = 0;
  let cur = null;
  for (const op of ops) {
    if (op === "m") {
      if (cur) (hunks.push(cur), (cur = null));
      i++;
      j++;
      continue;
    }
    cur ??= { a0: i, a1: i, b0: j, b1: j };
    if (op === "d") cur.a1 = ++i;
    else cur.b1 = ++j;
  }
  if (cur) hunks.push(cur);
  return hunks;
}

// 줄 비교용 키: 공백 · 대소문자를 무시하는 옵션을 반영
function lineKey(line, { ignoreSpace, ignoreCase }) {
  let s = line;
  if (ignoreSpace) s = s.replace(/\s+/g, " ").trim();
  if (ignoreCase) s = s.toLowerCase();
  return s;
}

// 줄 단위 비교: aLines, bLines = 줄 배열
export function diffLines(aLines, bLines, opts = {}) {
  const ka = aLines.map((l) => lineKey(l, opts));
  const kb = bLines.map((l) => lineKey(l, opts));
  // 앞뒤로 같은 줄은 먼저 덜어낸다 (큰 파일에서 빠르게)
  let head = 0;
  while (head < ka.length && head < kb.length && ka[head] === kb[head]) head++;
  let tail = 0;
  while (tail < ka.length - head && tail < kb.length - head && ka[ka.length - 1 - tail] === kb[kb.length - 1 - tail]) tail++;
  const ma = ka.slice(head, ka.length - tail);
  const mb = kb.slice(head, kb.length - tail);
  // 문자열 비교를 정수 비교로 (같은 줄은 같은 번호)
  const ids = new Map();
  const id = (s) => ids.get(s) ?? (ids.set(s, ids.size), ids.size - 1);
  const ia = ma.map(id);
  const ib = mb.map(id);
  return myers(ia, ib).map((h) => ({ a0: h.a0 + head, a1: h.a1 + head, b0: h.b0 + head, b1: h.b1 + head }));
}

const MAX_CHARS = 4000; // 한 줄이 이보다 길면 글자 단위 표시는 앞뒤 공통 부분만 덜어낸 가운데 전체로

// 두 줄 안에서 달라진 글자 범위: { a: [[시작, 끝], …], b: [[시작, 끝], …] } (끝 제외)
export function diffChars(a, b, opts = {}) {
  const sa = opts.ignoreCase ? a.toLowerCase() : a;
  const sb = opts.ignoreCase ? b.toLowerCase() : b;
  let head = 0;
  while (head < sa.length && head < sb.length && sa[head] === sb[head]) head++;
  let tail = 0;
  while (tail < sa.length - head && tail < sb.length - head && sa[sa.length - 1 - tail] === sb[sb.length - 1 - tail]) tail++;
  const ma = sa.slice(head, sa.length - tail);
  const mb = sb.slice(head, sb.length - tail);
  let hunks;
  if (ma.length > MAX_CHARS || mb.length > MAX_CHARS) hunks = [{ a0: 0, a1: ma.length, b0: 0, b1: mb.length }];
  else hunks = myers([...ma].map((c) => c.codePointAt(0)), [...mb].map((c) => c.codePointAt(0)), 400);
  // 글자 수(UTF-16)와 코드 포인트 수가 다를 수 있어(이모지) 위 결과는 코드 포인트 기준 → 일반 글자만 있으면 그대로
  const out = { a: [], b: [] };
  const hasAstral = /[\ud800-\udfff]/.test(ma + mb);
  const unit = (s, n) => (hasAstral ? [...s].slice(0, n).join("").length : n);
  for (const h of hunks) {
    const a0 = head + unit(ma, h.a0);
    const a1 = head + unit(ma, h.a1);
    const b0 = head + unit(mb, h.b0);
    const b1 = head + unit(mb, h.b1);
    if (a1 > a0) out.a.push([a0, a1]);
    if (b1 > b0) out.b.push([b0, b1]);
  }
  return out;
}

// 덩어리 종류: 왼쪽에만 있음(삭제) / 오른쪽에만 있음(추가) / 양쪽이 다름(변경)
export const hunkKind = (h) => (h.a1 === h.a0 ? "add" : h.b1 === h.b0 ? "del" : "mod");

// 요약: 추가 · 삭제 · 변경한 줄 수
export function summarize(hunks) {
  const s = { hunks: hunks.length, add: 0, del: 0, mod: 0 };
  for (const h of hunks) {
    const kind = hunkKind(h);
    if (kind === "add") s.add += h.b1 - h.b0;
    else if (kind === "del") s.del += h.a1 - h.a0;
    else s.mod += Math.max(h.a1 - h.a0, h.b1 - h.b0);
  }
  return s;
}
