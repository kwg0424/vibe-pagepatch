// URL 패턴 → match pattern.
// 변환 규칙은 원본(User JavaScript and CSS 3.1.2)의 변환 로직을 그대로 옮겼다. 기존 규칙이 같은 사이트에 적용되게.
//   naver.com            → *://*.naver.com/*   (점이 하나뿐인 도메인은 하위 도메인까지)
//   https://a.b.com/     → https://a.b.com/*   (끝에 * 를 붙임)
//   !…                   → 제외 (excludeMatches)
//   /정규식/플래그        → 주소 전체(location.href)에 정규식 검사. 예: /^https:\/\/(www\.)?youtube\.com\/(watch|shorts)/i
//                          정규식 안의 쉼표는 구분자로 보지 않는다. !/…/ 는 제외
// 위는 옛 '기존 방식'(옮기는 데만 씀 — migrateLegacyUrls). 규칙은 flags.urlBasic(기본) / flags.urlRegex(정규식) 중 하나 — 아래 basicPatterns · parseUrls.
// 옛 방식에서 strictUrl 이면 변환하지 않았다.

export function convertPattern(u) {
  if (u === "*") return "https://*/*";
  u = u.replace(/^http\*:\/\//, "*://");
  const neg = u.startsWith("!");
  if (neg) u = u.substring(1);
  if (!u.endsWith("*")) u += u.includes(".") && u.replace("://", "").includes("/") ? "*" : "/*";
  if (!/^[a-z*]+:\/\//.exec(u)) u = /^(\w+)\.(\w+)\/?/.exec(u) ? `https://${u}` : `https://*/*${u}`;
  const host = u.match(/:\/\/([^/]+)/)?.[1] || "";
  if (host.endsWith("*") && host.length > 1) u = u.replace(host, `${host.substring(0, host.length - 1)}/*`);
  if (!neg && host !== "*" && host.split(".").length < 3) u = u.replace("://", "://*.");
  return u.replace(/\*+/g, "*");
}

// 쉼표로 나누되 /정규식/ 안의 쉼표(\, [..] 포함)는 나누지 않는다
export function splitUrlItems(text) {
  const s = String(text || "");
  const items = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (i >= s.length) break;
    const start = i;
    const bang = s[i] === "!" ? 1 : 0;
    if (s[i + bang] === "/") {
      // 정규식: 닫는 / 까지 (이스케이프·문자 클래스 안의 / 는 건너뜀) + 플래그
      let j = i + bang + 1;
      let inClass = false;
      for (; j < s.length; j++) {
        const c = s[j];
        if (c === "\\") j++;
        else if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
      }
      if (j < s.length) {
        j++;
        while (j < s.length && /[a-z]/i.test(s[j])) j++;
        // 정규식 뒤에 쉼표·공백이 아닌 글자가 붙어 있으면 일반 패턴으로 본다
        if (j >= s.length || /[\s,]/.test(s[j])) {
          items.push(s.slice(start, j));
          i = j;
          continue;
        }
      }
    }
    let j = i;
    while (j < s.length && s[j] !== ",") j++;
    items.push(s.slice(start, j).trim());
    i = j;
  }
  return items.filter(Boolean);
}

const REGEX_ITEM = /^!?\/([\s\S]+)\/([a-z]*)$/i;

// 기본 방식 한 항목 → match pattern 목록 (안 되면 null)
//   a.com → 루트만 · a.com/** · a.com/* → 모든 경로 · *.a.com → 하위 도메인 (a.com 자신 포함, 브라우저 규칙) · * → 모든 사이트
//   스킴은 항상 http · https 둘 다. 앞에 써도 무시하고 저장할 때 지운다(normalizeBasicUrls). 포트(:3000)는 써도 된다. 그 밖의 경로는 받지 않는다
const BASIC_ITEM = /^(?:(https?|\*):\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(:\d+)?(\/\*\*?|\/)?$/i;
function basicPatterns(item) {
  const m = BASIC_ITEM.exec(item);
  if (!m) return null;
  const [, , host, port = "", tail = ""] = m; // 스킴은 써도 무시한다 (항상 http · https 둘 다)
  const base = `*://${host.toLowerCase()}${port}`;
  const list = host === "*" || tail.startsWith("/*") ? [`${base}/*`] : [`${base}/`, `${base}/?*`]; // 루트: 쿼리가 붙어도
  return list.every(isValidMatchPattern) ? list : null;
}

// 기본 방식 주소 글을 저장 모양으로: 스킴을 지운다 (https://*/* → */*). 올바르지 않은 항목은 그대로 둔다
export function normalizeBasicUrls(text) {
  return splitUrlItems(text)
    .map((item) => {
      const bang = item.startsWith("!") ? "!" : "";
      const rest = item.slice(bang.length).trim().replace(/^(https?|\*):\/\//i, "");
      return basicPatterns(rest) ? bang + rest : item;
    })
    .join(", ");
}

// → { matches, excludeMatches, regex: [{source, flags}], excludeRegex: [...], invalid: [잘못된 패턴] }
// flags: 규칙의 flags. urlRegex 면 /정규식/ 만, 아니면 기본 방식. (둘 다 없는 옛 규칙은 normalizeRule 이 먼저 옮기므로 여기 오지 않는다. 옮길 때만 옛 방식으로 읽음)
export function parseUrls(text, flags = {}) {
  const matches = [];
  const excludeMatches = [];
  const regex = [];
  const excludeRegex = [];
  const invalid = [];
  for (const item of splitUrlItems(text)) {
    const exclude = item.startsWith("!");
    const re = REGEX_ITEM.exec(item);
    if (flags.urlRegex || (re && !flags.urlBasic)) {
      if (!re) {
        invalid.push(item);
        continue;
      }
      try {
        new RegExp(re[1], re[2]);
        (exclude ? excludeRegex : regex).push({ source: re[1], flags: re[2] });
      } catch {
        invalid.push(item);
      }
      continue;
    }
    if (flags.urlBasic) {
      const list = basicPatterns(item.replace(/^!\s*/, ""));
      if (!list) invalid.push(item);
      else (exclude ? excludeMatches : matches).push(...list);
      continue;
    }
    const pattern = flags.strictUrl ? item.replace(/^!/, "") : convertPattern(item);
    if (!isValidMatchPattern(pattern)) invalid.push(pattern);
    else (exclude ? excludeMatches : matches).push(pattern);
  }
  return { matches, excludeMatches, regex, excludeRegex, invalid };
}

// '기존 방식'(urlBasic · urlRegex 둘 다 없는 옛 규칙)을 새 방식으로 옮긴다. 읽을 때마다 normalizeRule 이 부른다.
// 주소가 '호스트 + 모든 경로' 꼴이면 기본(a.com/**), 아니면 정규식으로 바꾼다. → { urls, flags: {urlBasic, urlRegex} } | null(이미 새 방식)
const PLAIN_PATTERN = /^(\*|https?):\/\/(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(:\d+)?\/\*$/i;
export function migrateLegacyUrls(urls, flags) {
  if (flags?.urlBasic || flags?.urlRegex) return null;
  const p = parseUrls(urls, { strictUrl: !!flags?.strictUrl });
  const groups = [["", p.matches, p.regex], ["!", p.excludeMatches, p.excludeRegex]];
  const useRegex = p.regex.length || p.excludeRegex.length || [...p.matches, ...p.excludeMatches].some((x) => !PLAIN_PATTERN.test(x));
  const lines = [];
  for (const [bang, patterns, regexes] of groups) {
    for (const x of patterns) {
      if (!useRegex) {
        const [, , host, port = ""] = PLAIN_PATTERN.exec(x);
        lines.push(`${bang}${host}${port}/**`);
      } else {
        const pr = patternRegex(x);
        if (pr) lines.push(`${bang}/${pr[0].replace(/\//g, "\\/")}/i`);
      }
    }
    for (const x of regexes) lines.push(`${bang}/${x.source}/${x.flags}`);
  }
  lines.push(...p.invalid); // 못 옮기는 항목은 그대로 둔다 (편집기에서 잘못된 패턴으로 보인다)
  return { urls: lines.join(", "), flags: { urlBasic: !useRegex, urlRegex: !!useRegex } };
}

// 등록할 match pattern. 정규식이 들어 있으면 모든 http(s) 페이지에 넣고 실행할 때 urlGuard 로 거른다
export function registrationPatterns(p) {
  if (!p.regex.length && !p.excludeRegex.length) return { matches: p.matches, excludeMatches: p.excludeMatches, guard: false };
  return { matches: p.regex.length ? ["*://*/*"] : p.matches, excludeMatches: p.excludeMatches, guard: true };
}

// 페이지 안에서 규칙 주소를 다시 검사하는 식 (정규식이 있는 규칙만). 결과: true/false
export function urlGuardCode(p) {
  const pat = (list) => JSON.stringify(list.map((x) => patternRegex(x)).filter(Boolean));
  const re = (list) => JSON.stringify(list.map((x) => [x.source, x.flags]));
  return `((u) => {
  const norm = (port) => location.protocol.slice(0, -1) + "://" + location.hostname + (port && location.port ? ":" + location.port : "") + location.pathname + location.search;
  const pm = (list) => list.some(([src, port]) => new RegExp(src, "i").test(norm(port)));
  const rm = (list) => list.some(([src, flags]) => new RegExp(src, flags).test(u));
  return (pm(${pat(p.matches)}) || rm(${re(p.regex)})) && !pm(${pat(p.excludeMatches)}) && !rm(${re(p.excludeRegex)});
})(location.href)`;
}

// 브라우저가 받아 주는 match pattern 인지 (등록 실패를 미리 막는다)
const PATTERN = /^(\*|https?|wss?|ftp|file):\/\/(\*|\*\.[^/*:]+|[^/*:]+)?(:(\*|\d+))?(\/.*)$/;

export function isValidMatchPattern(p) {
  if (p === "<all_urls>") return true;
  const m = PATTERN.exec(p);
  if (!m) return false;
  return m[1] === "file" || !!m[2];
}

const escape = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

// match pattern → [정규식 소스, 포트를 비교하는지]. 비교 대상: scheme://host[:port] + path + query (브라우저와 같게)
export function patternRegex(p) {
  if (p === "<all_urls>") return ["^(https?|wss?|ftp|file)://", false];
  const m = PATTERN.exec(p);
  if (!m) return null;
  const [, scheme, host = "", , port, path] = m;
  const schemeRe = scheme === "*" ? "https?" : escape(scheme);
  let hostRe;
  if (host === "*") hostRe = "[^/:]*";
  else if (host.startsWith("*.")) hostRe = `(?:[^/:]*\\.)?${escape(host.slice(2))}`;
  else hostRe = escape(host);
  const portRe = port === undefined || port === "*" ? "(?::\\d+)?" : `:${port}`;
  const pathRe = path.split("*").map(escape).join(".*");
  return [`^${schemeRe}://${hostRe}${portRe}${pathRe}$`, port !== undefined];
}

export function compilePattern(p) {
  const pr = patternRegex(p);
  if (!pr) return { test: () => false };
  const re = new RegExp(pr[0], "i");
  return {
    test(url) {
      let u;
      try {
        u = new URL(url);
      } catch {
        return false;
      }
      const portPart = pr[1] && u.port ? `:${u.port}` : "";
      return re.test(`${u.protocol.slice(0, -1)}://${u.hostname}${portPart}${u.pathname}${u.search}`);
    },
  };
}

// 규칙의 URL 이 이 주소에 해당하는지 (match pattern 또는 정규식, 제외 빼고)
export function ruleMatchesUrl(rule, url) {
  const p = parseUrls(rule.urls, rule.flags);
  const rx = (x) => {
    try {
      return new RegExp(x.source, x.flags).test(url);
    } catch {
      return false;
    }
  };
  if (!p.matches.some((x) => compilePattern(x).test(url)) && !p.regex.some(rx)) return false;
  return !p.excludeMatches.some((x) => compilePattern(x).test(url)) && !p.excludeRegex.some(rx);
}
