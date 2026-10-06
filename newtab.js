// 새 탭 페이지 (manifest chrome_url_overrides.newtab, StayTab 에서 옮김). 열리자마자 설정한 주소로 바꾼다.
// 설정은 저장소에서 바로 읽는다 → 서비스 워커를 거치지 않아 워커가 잠들어 있어도 바로 이동한다.
// location 대신 tabs.update 로 옮긴다 → 브라우저가 하는 이동이라 주소창 포커스가 남는다
import { normalizeSettings, normalizeUrl } from "./src/model.js";

const { settings } = await chrome.storage.local.get("settings");
const { newtab } = normalizeSettings(settings);
const url = newtab.on && normalizeUrl(newtab.url);
if (!url) document.getElementById("off").hidden = false;
else {
  const tab = await chrome.tabs.getCurrent();
  if (tab) chrome.tabs.update(tab.id, { url });
  else location.replace(url);
}
