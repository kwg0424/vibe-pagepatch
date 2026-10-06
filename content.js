// 모든 페이지(프레임 포함)에 들어가는 작은 스크립트. 규칙을 넣는 일은 background 가 한다.
//   - 맨 위 프레임: 페이지 열림 / SPA 주소 변경을 background 에 알린다 → 탭 CSS·배지 갱신
//   - 모든 프레임: 규칙 JS 가 보낸 기록(pagepatch:log 이벤트)을 background 로 넘긴다 → Claude 의 page_console
(() => {
  if (window.__pagepatchContent) return;
  window.__pagepatchContent = true;

  const send = (msg) => {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {} // 확장을 다시 불러온 뒤 남은 옛 스크립트
  };

  if (window === window.top) {
    send({ action: "page:open", url: location.href });
    // SPA 이동: navigate 이벤트(pushState·replaceState·뒤로가기 모두 옴) 뒤 0.5초 기다렸다가 주소가 바뀌었으면 알린다.
    // Navigation API 가 없으면 popstate 와 주소 검사로
    let timer = null;
    let last = location.href;
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (location.href === last) return;
        last = location.href;
        send({ action: "page:update", url: location.href });
      }, 500);
    };
    if (window.navigation) window.navigation.addEventListener("navigate", check);
    else {
      window.addEventListener("popstate", check);
      setInterval(check, 1000);
    }
  }

  document.addEventListener("pagepatch:log", (e) => {
    let entry;
    try {
      entry = JSON.parse(e.detail);
    } catch {
      return;
    }
    send({ action: "log", entry: { ...entry, url: location.href, frame: window === window.top ? "top" : "frame", t: Date.now() } });
  });
})();
