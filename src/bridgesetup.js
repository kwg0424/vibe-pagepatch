// Claude Code 연결 프로그램 등록 명령 (설정 화면 · 사이드바가 보여 준다).
// 연결 프로그램 파일(bridge/)은 확장 안에 같이 들어 있다 → GitHub 같은 바깥 주소에서 받지 않는다.
// 명령이 하는 일: Edge 가 이 확장을 풀어 둔 폴더(User Data\<프로필>\Extensions\<확장 ID>\<버전>\bridge)에서
// install.ps1 을 찾아 실행 → install.ps1 이 %LOCALAPPDATA%\PagePatch\bridge 로 복사해서 등록한다.
// PowerShell · cmd 어느 쪽에 붙여 넣어도 같게 -EncodedCommand(UTF-16LE base64)로 감싼다.

// arg: "" | "-WithMcp" (터미널 claude 에도 등록) | "-Uninstall"
export function setupScript(id, arg = "") {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$f = Get-ChildItem "$env:LOCALAPPDATA\\Microsoft\\Edge*\\User Data\\*\\Extensions\\${id}\\*\\bridge\\install.ps1" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1`,
    "if (-not $f) { throw 'PagePatch 확장 폴더를 찾지 못했습니다. 개발자 모드로 로드했다면 소스 폴더의 bridge\\install.ps1 을 실행하세요.' }",
    `& powershell -NoProfile -ExecutionPolicy Bypass -File $f.FullName ${arg}`.trim(),
  ].join("\n");
}

export function setupCommand(id, arg = "") {
  const script = setupScript(id, arg);
  let bin = "";
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i);
    bin += String.fromCharCode(c & 0xff, c >> 8);
  }
  return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${btoa(bin)}`;
}
