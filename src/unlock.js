// 우클릭·복사 허용. 사이트 목록은 settings.sites (src/model.js).
// 페이지 로드가 끝나면 그 사이트에 켜 둔 모드의 해제 스크립트를 페이지 환경(MAIN)·모든 프레임에 넣는다.
// 켤 때는 새로고침 없이 바로 넣고, 끄는 것은 새로고침해야 반영된다 (넣은 스크립트는 뺄 수 없음).

export const UNLOCK_MODES = {
  copy: "inject/unlock-copy.js", // 기본: 우클릭 + 선택 + 복사 허용
  strong: "inject/unlock-strong.js", // 강력: 키/마우스 이벤트 차단까지 무력화
};

// http(s) 페이지의 호스트. 아니면 null (내부 페이지·file 은 쓰지 않는다)
export function unlockHost(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname : null;
  } catch {
    return null;
  }
}

export async function injectUnlock(tabId, mode) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [UNLOCK_MODES[mode]], world: "MAIN" });
  } catch {
    // 넣을 수 없는 페이지(스토어, 내부 페이지 등)는 무시
  }
}

export async function applyUnlock(tabId, url, settings) {
  const host = unlockHost(url);
  const conf = host && settings.sites[host];
  if (!conf) return;
  if (conf.copy) await injectUnlock(tabId, "copy");
  if (conf.strong) await injectUnlock(tabId, "strong");
}
