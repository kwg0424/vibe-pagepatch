// 한/영 자판 변환 (두벌식). 키워드를 한/영 전환 없이 쳐도 맞추려고 쓴다.
//   toQwerty("지도") → "wleh"   한글을 영문 자판 상태에서 친 결과
//   toHangul("wleh") → "지도"   영문을 한글 자판 상태에서 친 결과

const KEYS = {
  ㅂ: "q", ㅈ: "w", ㄷ: "e", ㄱ: "r", ㅅ: "t", ㅛ: "y", ㅕ: "u", ㅑ: "i", ㅐ: "o", ㅔ: "p",
  ㅁ: "a", ㄴ: "s", ㅇ: "d", ㄹ: "f", ㅎ: "g", ㅗ: "h", ㅓ: "j", ㅏ: "k", ㅣ: "l",
  ㅋ: "z", ㅌ: "x", ㅊ: "c", ㅍ: "v", ㅠ: "b", ㅜ: "n", ㅡ: "m",
  ㅃ: "Q", ㅉ: "W", ㄸ: "E", ㄲ: "R", ㅆ: "T", ㅒ: "O", ㅖ: "P",
  // 두 키로 치는 겹모음·겹받침
  ㅘ: "hk", ㅙ: "ho", ㅚ: "hl", ㅝ: "nj", ㅞ: "np", ㅟ: "nl", ㅢ: "ml",
  ㄳ: "rt", ㄵ: "sw", ㄶ: "sg", ㄺ: "fr", ㄻ: "fa", ㄼ: "fq", ㄽ: "ft", ㄾ: "fx", ㄿ: "fv", ㅀ: "fg", ㅄ: "qt"
};

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = ["", ..."ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"];

export function toQwerty(text) {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code >= 0 && code < 11172) {
      out += KEYS[CHO[Math.floor(code / 588)]] + KEYS[JUNG[Math.floor((code % 588) / 28)]] + (KEYS[JONG[code % 28]] || "");
    } else out += KEYS[ch] ?? ch;
  }
  return out;
}

// 영문 키 → 낱자. 대문자는 쌍자음·ㅒㅖ 만 따로 있고 나머지는 소문자와 같다
const JAMO = Object.fromEntries(Object.entries(KEYS).filter(([, k]) => k.length === 1).map(([j, k]) => [k, j]));
const DOUBLE = Object.fromEntries(Object.entries(KEYS).filter(([, k]) => k.length === 2).map(([j, k]) => [k, j]));
const isVowel = (j) => JUNG.includes(j);

export function toHangul(text) {
  let out = "";
  let cho = "", jung = "", jong = "";
  const flush = () => {
    if (cho && jung) out += String.fromCharCode(0xac00 + CHO.indexOf(cho) * 588 + JUNG.indexOf(jung) * 28 + JONG.indexOf(jong));
    else out += cho + jung + jong;
    cho = jung = jong = "";
  };
  for (const ch of text) {
    const j = JAMO[ch] ?? JAMO[ch.toLowerCase()];
    if (!j) {
      flush();
      out += ch;
    } else if (isVowel(j)) {
      if (jong) {
        // 받침의 (마지막) 자음은 다음 글자의 첫소리로 넘어간다: "gks" + "k" → 하 + 나
        const keys = KEYS[jong];
        const next = keys.length === 2 ? JAMO[keys[1]] : jong;
        jong = keys.length === 2 ? JAMO[keys[0]] : "";
        flush();
        cho = next;
        jung = j;
      } else if (jung && DOUBLE[KEYS[jung] + KEYS[j]]) jung = DOUBLE[KEYS[jung] + KEYS[j]];
      else if (cho && !jung) jung = j;
      else {
        flush();
        jung = j;
      }
    } else if (cho && jung && !jong && JONG.includes(j)) jong = j;
    else if (jong && DOUBLE[KEYS[jong] + KEYS[j]] && JONG.includes(DOUBLE[KEYS[jong] + KEYS[j]])) jong = DOUBLE[KEYS[jong] + KEYS[j]];
    else {
      flush();
      cho = j;
    }
  }
  flush();
  return out;
}
