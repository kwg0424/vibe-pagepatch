// 데이터 비교 탭: 좌우 편집기(Ace)에 글을 넣으면 줄 · 글자 차이를 색으로 보여 주고, 덩어리마다 » « 로 반대쪽에 적용한다.
// 저장하지 않는다 (탭을 닫으면 사라짐). 외부 파일은 끌어다 놓으면 놓은 쪽 편집기에 들어간다.
import { diffLines, diffChars, hunkKind, summarize } from "./src/diff.js";

const $ = (s) => document.querySelector(s);
const MAX_BYTES = 5 * 1024 * 1024; // 파일 하나의 최대 크기
const SVG_NS = "http://www.w3.org/2000/svg";
// 파일 확장자 → 편집기 색 입히기 (보기만 예쁘게: 글 자체는 바꾸지 않는다). vendor/ace 에 있는 것만
const MODES = {
  js: "ace/mode/javascript", mjs: "ace/mode/javascript", cjs: "ace/mode/javascript", css: "ace/mode/css",
  json: "ace/mode/json", xml: "ace/mode/xml", rss: "ace/mode/xml", atom: "ace/mode/xml", xsd: "ace/mode/xml", xsl: "ace/mode/xml", xslt: "ace/mode/xml",
  yml: "ace/mode/yaml", yaml: "ace/mode/yaml", ini: "ace/mode/ini", cfg: "ace/mode/ini", inc: "ace/mode/ini", properties: "ace/mode/ini", toml: "ace/mode/toml",
};
const TEXT = "ace/mode/text";

// 붙여 넣은 글이 JSON · XML 이면 그 색으로 (파일 이름이 없을 때). 읽어 보고 틀리면 그냥 글로 둔다
function sniffMode(text) {
  if (text.length > 1_000_000) return TEXT; // 큰 글은 읽어 보지 않음 (느려짐 방지)
  const t = text.trimStart();
  const c = t[0];
  try {
    if (c === "{" || c === "[") {
      JSON.parse(t);
      return "ace/mode/json";
    }
    if (c === "<" && /^<(\?xml|[A-Za-z_])/.test(t)) {
      return new DOMParser().parseFromString(t, "application/xml").querySelector("parsererror") ? TEXT : "ace/mode/xml";
    }
  } catch {}
  return TEXT;
}

export function initCompare({ theme, toast }) {
  const Range = ace.require("ace/range").Range;
  const make = (id) => {
    const ed = ace.edit(id, {
      theme: theme(),
      mode: "ace/mode/text",
      fontSize: 13.5,
      showPrintMargin: false,
      useWorker: false,
      wrap: false,
      tabSize: 2,
      useSoftTabs: true,
      scrollPastEnd: 0.5, // 맨 아래에서 화면의 50% 만큼 더 내려갈 수 있게 (마지막 줄을 가운데까지 올릴 수 있음)
      animatedScroll: true, // 차이로 이동할 때 부드럽게
    });
    ed.session.setUseWrapMode(false);
    return ed;
  };
  const L = make("aceCmpL");
  const R = make("aceCmpR");
  const eds = [L, R];

  const mid = $("#cmpMid");
  const svg = $("#cmpSvg");
  const btns = $("#cmpBtns");
  const summary = $("#cmpSummary");
  const message = $("#cmpMessage");
  const opts = () => ({ ignoreSpace: $("#cmpWs").checked, ignoreCase: $("#cmpCase").checked });

  const modeFixed = [false, false]; // 편집기별: 파일 확장자로 색을 정했는가
  // 확장자로 정하지 않은 편집기는 글 내용(JSON · XML)을 보고 색을 맞춘다
  function autoMode() {
    eds.forEach((ed, k) => {
      if (modeFixed[k]) return;
      const want = sniffMode(ed.getValue());
      if (ed.session.getMode().$id !== want) ed.session.setMode(want);
    });
  }

  let hunks = [];
  let markers = [[], []];
  let nav = -1;
  let pendingNext = null; // 적용한 덩어리 자리 (적용한 뒤 그 자리에 오는 다음 덩어리를 반짝이기 위해)
  let timer;

  const lines = (ed) => ed.session.getDocument().getAllLines();
  const lineH = (ed) => ed.renderer.lineHeight;
  // 편집기 위쪽 기준 줄 y 좌표 (스크롤 반영)
  const rowY = (ed, row) => ed.session.documentToScreenRow(row, 0) * lineH(ed) - ed.renderer.scrollTop;

  function say(text, bad = false) {
    message.textContent = text;
    message.classList.toggle("error", bad);
    message.hidden = !text;
  }

  // ── 비교 · 표시 ──

  function clearMarkers() {
    eds.forEach((ed, k) => {
      markers[k].forEach((m) => ed.session.removeMarker(m));
    });
    markers = [[], []];
  }

  function mark(k, range, cls, type) {
    markers[k].push(eds[k].session.addMarker(range, cls, type, false));
  }

  function compare() {
    clearTimeout(timer);
    autoMode();
    const o = opts();
    const a = lines(L);
    const b = lines(R);
    const bothEmpty = a.length === 1 && !a[0] && b.length === 1 && !b[0];
    hunks = bothEmpty ? [] : diffLines(a, b, o);
    clearMarkers();
    for (const h of hunks) {
      const kind = hunkKind(h);
      for (let r = h.a0; r < h.a1; r++) mark(0, new Range(r, 0, r, 1), `cmp-${kind === "del" ? "del" : "mod"}`, "fullLine");
      for (let r = h.b0; r < h.b1; r++) mark(1, new Range(r, 0, r, 1), `cmp-${kind === "add" ? "add" : "mod"}`, "fullLine");
      if (kind === "mod") {
        // 바뀐 줄 안에서 달라진 글자 (위에서부터 같은 순서끼리 짝지음)
        for (let r = 0; r < Math.min(h.a1 - h.a0, h.b1 - h.b0); r++) {
          const ra = h.a0 + r;
          const rb = h.b0 + r;
          const d = diffChars(a[ra], b[rb], o);
          for (const [s, e] of d.a) mark(0, new Range(ra, s, ra, e), "cmp-char-mod", "text");
          for (const [s, e] of d.b) mark(1, new Range(rb, s, rb, e), "cmp-char-mod", "text");
        }
      }
    }
    const s = summarize(hunks);
    summary.textContent = bothEmpty
      ? ""
      : hunks.length
        ? `차이 ${s.hunks}곳`
        : "두 내용이 같습니다";
    summary.classList.toggle("same", !bothEmpty && !hunks.length);
    summary.classList.toggle("diff", hunks.length > 0); // 차이가 있으면 빨간색으로 강조
    nav = Math.min(nav, hunks.length - 1);
    paint();
    if (pendingNext !== null) {
      // » « 로 적용한 뒤: 다음 차이를 반짝여 보여 준다 (화면 밖이면 그쪽으로 이동)
      const i = Math.min(pendingNext, hunks.length - 1);
      pendingNext = null;
      if (i >= 0) {
        nav = i;
        const next = hunks[i];
        clearTimeout(flashWait);
        clearFlash();
        reveal(next, () => flash(next));
      }
    }
  }

  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(compare, 200);
  };

  // ── 가운데: 연결 띠와 적용 버튼 ──

  let raf = 0;
  const paint = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  };

  function draw() {
    const w = mid.clientWidth;
    const hgt = mid.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
    svg.replaceChildren();
    btns.replaceChildren();
    placeFlash(); // 반짝이는 중이면 스크롤을 따라가게 위치를 다시 맞춤
    for (const [k, h] of hunks.entries()) {
      const kind = hunkKind(h);
      const yl0 = rowY(L, h.a0);
      const yl1 = h.a1 > h.a0 ? rowY(L, h.a1) : yl0;
      const yr0 = rowY(R, h.b0);
      const yr1 = h.b1 > h.b0 ? rowY(R, h.b1) : yr0;
      if (Math.max(yl1, yr1) < 0 || Math.min(yl0, yr0) > hgt) continue; // 화면 밖
      const path = document.createElementNS(SVG_NS, "path");
      const c = w / 2;
      path.setAttribute("d", `M0,${yl0} C${c},${yl0} ${c},${yr0} ${w},${yr0} L${w},${Math.max(yr1, yr0 + 1)} C${c},${Math.max(yr1, yr0 + 1)} ${c},${Math.max(yl1, yl0 + 1)} 0,${Math.max(yl1, yl0 + 1)} Z`);
      path.setAttribute("class", `cmp-band cmp-band-${kind}${k === nav ? " on" : ""}${k === nav && flashing ? " flash" : ""}`);
      svg.append(path);

      const top = Math.max(0, Math.min(yl0, yr0));
      const row = document.createElement("div");
      row.className = "cmp-apply";
      row.style.top = `${Math.min(top, hgt - 24)}px`;
      const lr = document.createElement("button");
      lr.type = "button";
      lr.textContent = "»";
      lr.title = "왼쪽 내용을 오른쪽에 적용";
      lr.onclick = () => apply(h, "lr", k);
      const rl = document.createElement("button");
      rl.type = "button";
      rl.textContent = "«";
      rl.title = "오른쪽 내용을 왼쪽에 적용";
      rl.onclick = () => apply(h, "rl", k);
      row.append(rl, lr);
      btns.append(row);
    }
  }

  // 덩어리 적용: 한쪽의 줄을 반대쪽 같은 자리의 줄로 바꾼다 (지울 줄이 없는 쪽이면 끼워 넣음). 편집기의 실행 취소(Ctrl+Z)로 되돌릴 수 있다.
  function apply(h, dir, index) {
    const [src, dst] = dir === "lr" ? [L, R] : [R, L];
    const [s0, s1] = dir === "lr" ? [h.a0, h.a1] : [h.b0, h.b1];
    const [d0, d1] = dir === "lr" ? [h.b0, h.b1] : [h.a0, h.a1];
    const next = [...lines(dst).slice(0, d0), ...lines(src).slice(s0, s1), ...lines(dst).slice(d1)];
    pendingNext = index; // 적용하면 이 덩어리가 사라지고 다음 덩어리가 이 번호가 된다
    setText(dst, next.join("\n"));
    compare(); // 입력 대기(0.2초) 없이 바로 다시 비교해서 곧바로 반짝임
  }

  const setText = (ed, text) => {
    const doc = ed.session.getDocument();
    const last = doc.getLength() - 1;
    doc.replace(new Range(0, 0, last, doc.getLine(last).length), text); // 한 번의 편집이라 한 번에 취소됨
  };

  // ── 차이 이동 ──

  // 한쪽의 줄 번호(소수 가능)에 대응하는 반대쪽 줄 번호. side 0: 왼쪽 → 오른쪽
  function mapRow(side, row) {
    let delta = 0;
    for (const h of hunks) {
      const [s0, s1, d0, d1] = side === 0 ? [h.a0, h.a1, h.b0, h.b1] : [h.b0, h.b1, h.a0, h.a1];
      // 이 덩어리보다 아래: 줄 수 차이만큼 밀림 (이쪽에 줄이 없는 덩어리는 그 자리 줄이 덩어리 시작과 맞닿음 → 그보다 아래일 때만)
      if (s1 > s0 ? row >= s1 : row > s0) delta += d1 - d0 - (s1 - s0);
      else if (row > s0) return d0 + ((row - s0) / (s1 - s0)) * (d1 - d0); // 덩어리 안: 비율로
      else break;
    }
    return Math.max(0, row + delta);
  }

  // 덩어리가 좌우 모두 보이게 각각 가운데로 부드럽게 이동한 뒤 done() (이미 둘 다 보이면 움직이지 않고 바로 done).
  // 이동하는 동안은 스크롤 연동을 잠가서 한쪽 이동이 반대쪽 위치를 되돌리지 않게 한다
  // 줄 r0~r1(끝 제외)이 편집기 안쪽에 편하게 보이는지: 시작이 위쪽 15% ~ 아래쪽 70% 사이이고, 화면에 들어가는 크기면 끝도 95% 안
  // (화면 맨 아래에 걸쳐 있거나 반쯤 잘려 보이는 것은 "보인다"로 치지 않고 가운데로 옮긴다)
  const comfortable = (ed, r0, r1) => {
    const h = ed.renderer.$size.scrollerHeight;
    const top = rowY(ed, r0);
    if (top < h * 0.15 || top > h * 0.7) return false;
    const bottom = rowY(ed, Math.max(r1, r0 + 1));
    return bottom - top > h * 0.8 || bottom <= h * 0.95;
  };

  function reveal(h, done) {
    if (comfortable(L, h.a0, h.a1) && comfortable(R, h.b0, h.b1)) return done();
    syncLock = performance.now() + 450;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      done();
    };
    L.scrollToLine(h.a0, true, true);
    R.scrollToLine(h.b0, true, true, fire);
    setTimeout(fire, 140); // 더 못 움직이는 자리(문서 맨 위 · 맨 아래)라 콜백이 안 와도 늦지 않게
  }

  function go(delta) {
    if (!hunks.length) return;
    // 지금 보이는 줄 기준으로 가까운 차이를 먼저, 그다음부터 순서대로
    nav = nav < 0 ? (delta > 0 ? 0 : hunks.length - 1) : (nav + delta + hunks.length) % hunks.length;
    const h = hunks[nav];
    paint();
    clearTimeout(flashWait);
    clearFlash();
    reveal(h, () => flash(h));
  }

  // 이동한 차이를 한 번 은은하게 반짝여서 어디인지 알려 준다 (양쪽 편집기의 해당 줄 + 가운데 띠)
  let flashWait;
  let flashEnd;
  // 반짝임은 Ace 마커가 아니라 편집기 위에 얹는 별도 요소로 그린다: Ace 는 스크롤할 때마다 마커 요소를 다시 쓰기 때문에
  // 마커로 하면 반짝임 애니메이션이 끊기거나 한쪽이 안 보이는 일이 있었다. 요소는 새로 만들어서 애니메이션이 항상 처음부터 돈다.
  let flashEls = []; // { el, ed, r0, r1 }
  let flashing = false;
  function clearFlash() {
    clearTimeout(flashEnd);
    flashEls.forEach((f) => f.el.remove());
    flashEls = [];
    if (flashing) {
      flashing = false;
      paint();
    }
  }
  // 줄 r0 ~ r1(끝 제외)의 위치에 맞춰 놓기 (스크롤해도 따라감). 줄이 없는 쪽(r0 == r1)은 끼워질 자리에 굵은 선
  function placeFlash() {
    for (const f of flashEls) {
      const { ed, r0, r1, el } = f;
      const lh = lineH(ed);
      const len = ed.session.getLength();
      const y = (row) => (row >= len ? rowY(ed, len - 1) + lh : rowY(ed, row));
      const y0 = y(r0);
      const gap = r1 === r0;
      const top = gap ? Math.max(1, y0 - 3) : y0;
      el.style.top = `${top}px`;
      el.style.height = `${gap ? 6 : y(r1) - y0}px`;
      el.style.left = `${ed.renderer.scroller.offsetLeft}px`;
    }
  }
  function flash(h) {
    clearFlash();
    const add = (ed, r0, r1) => {
      const el = document.createElement("div");
      el.className = r1 === r0 ? "cmp-flash-gap" : "cmp-flash-box";
      ed.container.append(el);
      flashEls.push({ el, ed, r0, r1 });
    };
    add(L, h.a0, h.a1);
    add(R, h.b0, h.b1);
    flashing = true;
    placeFlash();
    paint();
    flashEnd = setTimeout(clearFlash, 900);
  }

  // ── 파일 · 글 넣기 ──

  async function readText(file) {
    if (file.size > MAX_BYTES) throw new Error(`${file.name}: 파일이 너무 큽니다 (${(file.size / 1048576).toFixed(1)}MB, 최대 5MB)`);
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.subarray(0, 8000).includes(0) && !(bytes[0] === 0xff && bytes[1] === 0xfe) && !(bytes[0] === 0xfe && bytes[1] === 0xff)) {
      throw new Error(`${file.name}: 글자 파일이 아닙니다`);
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      return new TextDecoder("euc-kr").decode(buf); // UTF-8 이 아니면 한글 윈도우 파일(CP949)로 읽음
    }
  }

  async function load(side, file) {
    const ed = eds[side];
    const text = await readText(file);
    setText(ed, text.replace(/\r\n?/g, "\n"));
    const byName = MODES[/\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase()];
    modeFixed[side] = !!byName; // 확장자로 정한 색은 유지, 아니면 글 내용을 보고 정함
    ed.session.setMode(byName || TEXT);
    ed.moveCursorTo(0, 0);
    ed.session.setScrollTop(0);
    $(side ? "#cmpNameR" : "#cmpNameL").textContent = file.name;
  }

  async function drop(files, side) {
    say("");
    const list = [...files];
    try {
      if (list.length >= 2) {
        await load(0, list[0]);
        await load(1, list[1]);
        if (list.length > 2) say(`파일 ${list.length}개 중 앞의 두 개만 넣었습니다`);
      } else if (list.length === 1) {
        await load(side, list[0]);
      }
    } catch (e) {
      say(e.message, true);
    }
    compare();
  }

  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  const panes = [[$("#aceCmpL"), 0], [$("#aceCmpR"), 1]];
  const area = $("#compare");
  area.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const side = panes.find(([el]) => el.contains(e.target))?.[1];
    panes.forEach(([el, k]) => el.classList.toggle("drop", side === k || (side === undefined && e.dataTransfer.items.length >= 2)));
  });
  area.addEventListener("dragleave", (e) => {
    if (!area.contains(e.relatedTarget)) panes.forEach(([el]) => el.classList.remove("drop"));
  });
  area.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // 편집기에 파일 이름이 글로 들어가거나 페이지가 파일로 이동하지 않게
    panes.forEach(([el]) => el.classList.remove("drop"));
    const side = panes.find(([el]) => el.contains(e.target))?.[1];
    // 편집기 밖에 놓으면: 왼쪽이 비어 있으면 왼쪽, 아니면 오른쪽
    drop(e.dataTransfer.files, side ?? (lines(L).join("").length ? 1 : 0));
  });

  // ── 버튼 · 옵션 ──

  $("#cmpPrev").onclick = () => go(-1);
  $("#cmpNext").onclick = () => go(1);
  $("#cmpWs").onchange = $("#cmpCase").onchange = compare;
  $("#cmpSwap").onclick = () => {
    const [a, b] = [lines(L).join("\n"), lines(R).join("\n")];
    const names = [$("#cmpNameL").textContent, $("#cmpNameR").textContent];
    const modes = [L.session.getMode().$id, R.session.getMode().$id];
    const fixed = [...modeFixed];
    setText(L, b);
    setText(R, a);
    L.session.setMode(modes[1]); // 색 입히기도 같이 바꿈
    R.session.setMode(modes[0]);
    modeFixed[0] = fixed[1];
    modeFixed[1] = fixed[0];
    $("#cmpNameL").textContent = names[1];
    $("#cmpNameR").textContent = names[0];
  };
  for (const [side, ed] of eds.entries()) {
    const sfx = side ? "R" : "L";
    $(`#cmpClear${sfx}`).onclick = () => {
      setText(ed, "");
      modeFixed[side] = false;
      ed.session.setMode(TEXT);
      $(`#cmpName${sfx}`).textContent = side ? "비교" : "원본";
      say("");
    };
    $(`#cmpCopy${sfx}`).onclick = async () => {
      try {
        await navigator.clipboard.writeText(lines(ed).join("\n"));
        toast("복사했습니다");
      } catch {
        toast("복사하지 못했습니다");
      }
    };
  }

  // 이 화면을 여는 단축키 표시 (edge://extensions/shortcuts 에서 바꿀 수 있음)
  const shortcut = $("#cmpShortcut");
  chrome.commands?.getAll().then((all) => {
    const key = all.find((c) => c.name === "open-compare")?.shortcut;
    shortcut.textContent = key ? `· 단축키 ${key}` : "· 단축키 없음";
    const set = document.createElement("a");
    set.href = "#";
    set.textContent = "바꾸기";
    set.onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: "edge://extensions/shortcuts" });
    };
    shortcut.append(" ", set);
  });

  // ── 편집기 이벤트 ──

  let syncing = false;
  let syncLock = 0; // 이 시각(performance.now)까지는 스크롤 연동을 하지 않는다 (차이로 이동하는 중)
  const muteUntil = [0, 0]; // 편집기별: 이 시각까지는 그 편집기의 스크롤 이벤트로 반대쪽을 움직이지 않는다 (따라가는 중인 쪽)
  eds.forEach((ed, k) => {
    ed.session.on("change", later);
    ed.renderer.on("afterRender", paint);
    ed.session.on("changeScrollTop", (top) => {
      const now = performance.now();
      if (syncing || now < syncLock || now < muteUntil[k]) return;
      syncing = true;
      // 한쪽을 스크롤하면 반대쪽도 같이: 같은 픽셀이 아니라 "대응하는 줄"로 맞춘다 (줄 수가 다른 덩어리를 건너뛰어도 좌우 같은 내용이 마주 보임)
      const other = eds[1 - k];
      // 따라가는 쪽은 더 못 내려가서 맨 아래/위로 보정되며 스크롤 이벤트를 다시 내는데, 그걸 받아 끌고 온 쪽을 되돌리면
      // (왼쪽이 짧은 문서일 때) 긴 쪽이 더 이상 안 내려간다 → 따라가는 쪽의 이벤트는 잠깐 무시
      muteUntil[1 - k] = now + 200;
      other.session.setScrollTop(mapRow(k, top / lineH(ed)) * lineH(other));
      syncing = false;
      paint();
    });
  });
  addEventListener("resize", () => {
    eds.forEach((ed) => ed.resize());
    paint();
  });
  new ResizeObserver(() => {
    eds.forEach((ed) => ed.resize());
    paint();
  }).observe($(".cmp-body"));

  return {
    resize() {
      eds.forEach((ed) => ed.resize(true));
      compare();
    },
    setTheme() {
      eds.forEach((ed) => ed.setTheme(theme()));
    },
  };
}
