// 파일 보기(JSON · CSV · …) 공통: 윗줄(로고 · 원본/정리 전환 · 내용 복사 · 글자 크기) · 어두운 틀 · 큰 파일 안내.
// manifest 의 content_scripts 에서 각 형식 파일보다 먼저 불러서 globalThis.PPView 로 나눠 쓴다.

(() => {
  if (globalThis.PPView) return;

  const MAX_CHARS = 1_000_000; // 이보다 크면 보기를 만들지 않고 맨 윗줄에 이유만 적는다

  const el = (tag, cls, text) => {
    const e = document.createElementNS("http://www.w3.org/1999/xhtml", tag); // XML 문서(브라우저 XML 화면)에서도 HTML 요소가 되도록
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // PagePatch 로고 (icons/icon-32.png 를 그대로 넣음. 웹페이지에 확장 파일을 공개하지 않으려고 주소 대신 데이터로)
  const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABPElEQVR42s2XsQrCMBCG8whdfIS8R98lODgI3XwRZ3FxURycnR0EsaubD5ChiIsW4eRKAyU0ySUkxh9uKTT/19xdmmNsIC5kwYWsuJA1FxIiR92vXbAxcSFLLmSTwFgP9CjHzOHHUQ63vckA0HTp6PMCmaJiiQqOXJgs5oKz5QOO1zecb20Xi9XT+U40gP3pBWPC58kBTOZKtp1gqc1RmI4kALvDGihKArDdTKG9TOBznzsBsDCjAihzFS4I7I5oALq5CyJqF5jMTRAucy8ALDibuQ5BMScDqFbDxSkQCEv9MObb5y4ITJNPWlnIIWOC8DW3AmDr2KRDhJhbAfDwcElBhJpbAfD4pMin4KIDUFstCAB/oanNg7sgljnpHMCdUFcsLEzbjyUUIPulNPu1PO9gkn00+4vhNOd4/gXVJF0vqwDX1AAAAABJRU5ErkJggg==";

  const BASE_CSS = `
    html, body { margin: 0; background: #1b1d23; color-scheme: dark; }
    #pp-bar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 6px 12px;
      background: #21252b; color: #9da5b4; font: 12px/1.4 "Segoe UI", "Malgun Gothic", sans-serif; border-bottom: 1px solid #181a1f; }
    #pp-bar img { width: 16px; height: 16px; }
    #pp-bar button { font: inherit; color: #abb2bf; background: #2c313a; border: 1px solid #3e4451; border-radius: 4px; padding: 2px 10px; cursor: pointer; }
    #pp-bar button:hover { background: #3a3f4b; }
    #pp-bar .fsv { display: inline-block; min-width: 30px; margin-left: 6px; color: #7f8794; font-size: 11px; font-weight: 400; }
    #pp-bar .grp { display: inline-flex; }
    #pp-bar .grp button { border-radius: 0; min-width: 28px; padding: 2px 8px; }
    #pp-bar .grp button + button { margin-left: -1px; }
    #pp-bar .grp button:first-child { border-radius: 4px 0 0 4px; }
    #pp-bar .grp button:last-child { border-radius: 0 4px 4px 0; }
    #pp-bar .grp button:nth-child(2) { font-weight: 600; color: #e6e6e6; min-width: 64px; }
    #pp-bar .ext { color: #98c379; font-weight: 600; }
    #pp-bar .warn { color: #e5c07b; } #pp-bar .warn:empty { display: none; }
    #pp-view { box-sizing: border-box; width: fit-content; min-width: min(720px, calc(100% - 32px)); max-width: calc(100% - 32px); margin: 16px auto; /* 글이 짧으면 가운데에 좁게, 길어서 넘치면 좌우 꽉 채움 */ padding: 14px 36px 18px 18px; background: #282c34; border: 1px solid #3e4451; border-radius: 10px; box-shadow: 0 4px 20px rgba(0, 0, 0, .35); color: #abb2bf; font: var(--pp-fs, 13px)/1.55 Consolas, "D2Coding", monospace; word-break: break-all; }
    #pp-view a { color: inherit; text-decoration: underline; }
    #pp-view a:hover { color: #c8e6b0; }
  `;

  const RAW_STYLE = "color:#abb2bf;margin:0;padding:10px 14px;white-space:pre-wrap;word-break:break-all;font-size:var(--pp-fs,13px)";

  // 브라우저가 텍스트 파일을 보여 주는 모양(<pre> 하나)일 때만 { pre, text, ct }. 아니면 null (일반 웹페이지는 건드리지 않음)
  function plainText() {
    const body = document.body;
    const pre = body?.firstElementChild;
    if (pre?.tagName !== "PRE" || body.textContent.trim() !== pre.textContent.trim()) return null; // 다른 확장이 빈 요소를 붙여도 됨
    return { pre, text: pre.textContent, ct: document.contentType || "" };
  }

  const fileExt = () => (/\.([a-z0-9]+)$/i.exec(location.pathname) || [])[1]?.toLowerCase() || "";

  // 설정의 형식별 켜고 끔 (저장된 게 없으면 켜짐)
  async function enabled(key) {
    const { settings } = await chrome.storage.local.get("settings");
    return settings?.fileView?.[key] !== false;
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => { // http 주소(localhost 가 아닌)는 clipboard 를 못 쓸 수 있어 대체 방법
      const ta = el("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      ok ? resolve() : reject(new Error("복사 실패"));
    });
  }

  function makeBar(text, warn) {
    const bar = el("div");
    bar.id = "pp-bar";
    const logo = el("img");
    logo.src = LOGO;
    logo.alt = "PagePatch";
    bar.append(logo, el("span", warn ? "warn" : "", text));
    return bar;
  }

  // 보기를 만들지 않고 원본 그대로 두면서 맨 윗줄에 이유만 적는다 (문법 오류 등)
  function notice(pre, message) {
    document.head.append(el("style", "", BASE_CSS));
    document.body.prepend(makeBar(message, true));
    pre.style.cssText = RAW_STYLE;
  }

  // 1MB 를 넘는 파일: 처음에는 원본 상태로 두고, 사용자가 정리하기를 누르면 그때 보기를 만든다
  const isBig = (text) => text.length > MAX_CHARS;
  const bigNote = (text) => `파일이 커서(${(text.length / 1e6).toFixed(1)}MB) 정리하지 않았습니다 (기준 1MB)`;

  // 화면 붙이기. ext: 윗줄 초록 글자(예: "JSON"), css: 형식별 스타일,
  // build(): 보기 요소를 만든다 (실패하면 Error 의 message 를 윗줄에 적고 원본 상태로 둠. 큰 파일은 정리하기를 눌렀을 때 처음 부른다),
  // copy(raw): 내용 복사 글 (raw = 원본 상태인지), startRaw: 원본 상태로 시작, note: 윗줄 안내 글
  function mount({ pre, build, ext, css = "", copy, startRaw = false, note = "", rawLabel = "원본 보기", prettyLabel = "정리하기" }) {
    const bar = makeBar("PagePatch · ");
    bar.lastChild.append(el("span", "ext", ext));
    const noteEl = el("span", "warn", note);
    let view = null;
    let raw = startRaw;

    const toggle = el("button", "");
    const show = () => {
      if (!raw && !view) {
        try {
          view = build();
          view.id = "pp-view";
          bar.after(view);
        } catch (e) {
          noteEl.textContent = e.message;
          raw = true;
        }
      }
      if (view) view.hidden = raw;
      pre.style.cssText = raw ? RAW_STYLE : "display:none";
      toggle.textContent = raw ? prettyLabel : rawLabel;
      if (!raw) noteEl.textContent = "";
    };
    toggle.onclick = () => {
      raw = !raw;
      show();
    };

    const copyBtn = el("button", "", "내용 복사");
    let timer;
    copyBtn.onclick = async () => {
      try {
        await copyText(copy(raw));
        copyBtn.textContent = "복사됨";
      } catch {
        copyBtn.textContent = "복사 실패";
      }
      clearTimeout(timer);
      timer = setTimeout(() => (copyBtn.textContent = "내용 복사"), 1200);
    };

    // 글자 크기: [−][A][+] 한 묶음. −/+ 는 4px 씩, 가운데 A 는 원래 크기로. 저장하지 않아서 새로고침해도 원래 크기 (보기와 원본 둘 다)
    const FS0 = 13;
    let fs = FS0;
    const fsView = el("span", "fsv", `${FS0}px`);
    const setFs = (px) => {
      fs = Math.min(41, Math.max(5, px));
      document.documentElement.style.setProperty("--pp-fs", `${fs}px`);
      fsView.textContent = `${fs}px`;
    };
    const part = (label, title, fn) => {
      const b = el("button", "", label);
      b.title = title;
      b.onclick = fn;
      return b;
    };
    const group = el("span", "grp");
    const reset = part("A", "원래 크기", () => setFs(FS0));
    reset.append(fsView);
    group.append(part("−", "글자 작게", () => setFs(fs - 4)), reset, part("+", "글자 크게", () => setFs(fs + 4)));

    bar.append(noteEl, toggle, copyBtn, group);
    document.head.append(el("style", "", BASE_CSS + css));
    document.body.prepend(bar);
    show();
  }

  // 줄 번호 + 색 보기 (JS · CSS · YAML · TOML · INI 가 같이 씀). 토큰 [분류, 글자] → 줄 요소 목록
  // 분류: kw(키워드) s(문자열) n(숫자) c(주석) f(함수) k(키) tag(태그) cl(클래스) sec([섹션] 제목) bo(true/false) nu(null) lit(리터럴)
  function toLines(tokens) {
    const lines = [el("div", "l")];
    for (const [cls, text] of tokens) {
      text.split("\n").forEach((part, k) => {
        if (k) lines.push(el("div", "l"));
        if (part) lines.at(-1).append(cls ? el("span", cls, part) : document.createTextNode(part));
      });
    }
    if (lines.length > 1 && !lines.at(-1).firstChild) lines.pop(); // 끝 줄바꿈 뒤의 빈 줄은 번호를 붙이지 않음
    return lines;
  }

  const LINE_CSS = `
    #pp-view { padding: 12px 36px 14px 0; white-space: pre-wrap; counter-reset: l; }
    #pp-view .l { position: relative; min-height: 1.55em; padding-left: 4.6em; counter-increment: l; color: #abb2bf; }
    #pp-view .l::before { content: counter(l); position: absolute; left: 0; width: 3.4em; text-align: right; color: #5c6370; user-select: none; } /* 줄 번호는 CSS 로 그려서 드래그 · 복사에 잡히지 않음 */
    #pp-view .kw, #pp-view .bo { color: #c678dd; } #pp-view .s { color: #98c379; } #pp-view .n, #pp-view .lit { color: #d19a66; }
    #pp-view .c { color: #5c6370; font-style: italic; } #pp-view .f { color: #61afef; } #pp-view .nu { color: #56b6c2; }
    #pp-view .k, #pp-view .tag, #pp-view .t { color: #e06c75; } #pp-view .cl { color: #e5c07b; } #pp-view .sec { color: #61afef; font-weight: 600; } /* [섹션] · [표] 제목: 키(붉은 분홍)와 구분 */
  `;

  globalThis.PPView = { el, plainText, fileExt, enabled, isBig, bigNote, notice, mount, toLines, LINE_CSS };
})();
