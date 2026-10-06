// 탭 복원 (StayTab 에서 옮김). 열린 탭 목록을 기억해 두었다가, 창이 모두 닫힌 뒤(백그라운드 상주 중) 다시 열면 복원한다.
// 상주 자체는 선택 권한 "background" 가 해 준다 (설정 → 브라우저에서 켜고 끔).
//   chrome.storage.local   { staySession: [{ url, pinned }] }  마지막으로 열려 있던 탭 (이 PC에만)
//   chrome.storage.session { stayIdle: true }                  창이 0개인 상태 (서비스 워커가 잠들어도 유지, 브라우저 종료 시 사라짐)
// 설정(settings.restore, settings.newtab)은 background 가 getSettings 로 넘겨준다.
import { normalizeUrl } from "./model.js";

const NEWTAB = /^(edge|chrome):\/\/newtab\/?$/i;
const OWN_NEWTAB = chrome.runtime.getURL("newtab.html");
const SAVABLE = /^(https?|file):/i;
const NORMAL = { windowTypes: ["normal"] };

export function initStay({ getSettings }) {
  // 탭이 바뀔 때마다 저장하되, 연달아 바뀌면 1초 뒤 한 번만
  let saveTimer;
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSession, 1000);
  };

  async function saveSession() {
    const wins = (await chrome.windows.getAll({ ...NORMAL, populate: true })).filter((w) => !w.incognito);
    // 마지막 창을 닫는 중이면 직전 목록을 그대로 둔다 (이걸 복원해야 하므로)
    if (!wins.length) return;
    const staySession = wins
      .flatMap((w) => w.tabs)
      .filter((t) => SAVABLE.test(t.url))
      .map((t) => ({ url: t.url, pinned: t.pinned }));
    await chrome.storage.local.set({ staySession });
  }

  chrome.tabs.onCreated.addListener(saveSoon);
  chrome.tabs.onUpdated.addListener((_tabId, info) => {
    if (info.status === "complete" || "pinned" in info) saveSoon();
  });
  chrome.tabs.onRemoved.addListener((_tabId, info) => {
    if (!info.isWindowClosing) saveSoon();
  });
  chrome.tabs.onMoved.addListener(saveSoon);
  chrome.tabs.onAttached.addListener(saveSoon);
  chrome.runtime.onStartup.addListener(saveSoon);
  chrome.runtime.onInstalled.addListener(saveSession);

  // 창이 모두 닫힘 → 다시 열림
  chrome.windows.onRemoved.addListener(async () => {
    const wins = await chrome.windows.getAll(NORMAL);
    if (wins.length) saveSoon(); // 창 하나만 닫았으면 남은 창 기준으로 다시 저장
    else await chrome.storage.session.set({ stayIdle: true });
  }, NORMAL);

  chrome.windows.onCreated.addListener(async (win) => {
    const { stayIdle } = await chrome.storage.session.get("stayIdle");
    if (!stayIdle) return;
    await chrome.storage.session.remove("stayIdle");
    if (win.incognito) return;

    const settings = await getSettings();
    const { staySession = [] } = await chrome.storage.local.get("staySession");
    if (!settings.restore || !staySession.length) return;

    // 창을 열면서 같이 뜬 탭: 빈 새 탭(또는 이미 새 탭 주소로 간 탭)은 복원 후 닫고, 다른 앱에서 링크로 연 탭은 둔다
    const target = settings.newtab.on && normalizeUrl(settings.newtab.url);
    const initial = await chrome.tabs.query({ windowId: win.id });
    const urlOf = (t) => t.pendingUrl || t.url || "";
    const isBlank = (t) => {
      const u = urlOf(t);
      return !u || u === "about:blank" || NEWTAB.test(u) || u === OWN_NEWTAB || u === target;
    };
    const open = new Set(initial.filter((t) => !isBlank(t)).map(urlOf));

    let first = true;
    for (const t of staySession) {
      if (open.has(t.url)) continue; // 브라우저가 스스로 복원한 탭과 겹치지 않게
      await chrome.tabs.create({ windowId: win.id, url: t.url, pinned: t.pinned, active: first }).catch(() => {});
      first = false;
    }
    const blank = initial.filter(isBlank).map((t) => t.id);
    if (blank.length && !first) await chrome.tabs.remove(blank).catch(() => {});
  }, NORMAL);
}
