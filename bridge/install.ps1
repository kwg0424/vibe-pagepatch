# PagePatch Claude Code 연결 프로그램 등록 (Windows, 이 사용자만).
#   powershell -ExecutionPolicy Bypass -File install.ps1            사이드바 채팅용 등록
#   powershell -ExecutionPolicy Bypass -File install.ps1 -WithMcp   + 터미널 claude 에서도 PagePatch 도구 쓰기
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall 등록 해제
# 스토어 설치본은 설정 화면의 명령으로 실행한다: Edge 가 확장을 풀어 둔 폴더(…\Extensions\<id>\<버전>\bridge)의 이 파일을 찾아 실행
#
# 하는 일
#   0. 확장 폴더에서 실행됐으면 bridge 파일을 %LOCALAPPDATA%\PagePatch\bridge 로 복사해서 그걸 쓴다
#      (확장이 업데이트되면 버전 폴더가 바뀌고 예전 폴더는 지워지므로)
#   1. %LOCALAPPDATA%\PagePatch\ 에 config.json(node·claude 경로), pagepatch-host.cmd, 네이티브 메시징 매니페스트를 만든다
#   2. HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.pagepatch.bridge 에 매니페스트 경로를 등록한다
#      (매니페스트는 PagePatch 확장 ID 만 허용)
#   3. -WithMcp: claude mcp add --scope user pagepatch -- node bridge\mcp.mjs
param([switch]$WithMcp, [switch]$Uninstall)
$ErrorActionPreference = "Stop"

$HostName = "com.pagepatch.bridge"
$ExtensionIds = @(
  "ljpifelibjbpdkjmjpalhegmmpopaakn", # 개발자 모드 (manifest.json 의 key 로 고정된 ID)
  "ebpahfbghidgbkmbjhgijokfjmoeccan"  # Edge 추가 기능 스토어
)
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Data = Join-Path $env:LOCALAPPDATA "PagePatch"
$Manifest = Join-Path $Data "$HostName.json"
$Cmd = Join-Path $Data "pagepatch-host.cmd"
$BridgeCopy = Join-Path $Data "bridge"
$RegKeys = @(
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName",
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
)

function Write-Utf8($path, $text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

# 등록 안 된 상태면 claude 가 stderr 에 쓰는데, PowerShell 5.1 은 Stop 일 때 그걸 오류로 멈춘다
function Remove-Mcp($claudeExe) {
  $ErrorActionPreference = "Continue"
  & $claudeExe mcp remove --scope user pagepatch 2>$null | Out-Null
}

if ($Uninstall) {
  foreach ($k in $RegKeys) { if (Test-Path $k) { Remove-Item $k -Force } }
  foreach ($f in @($Manifest, $Cmd)) { if (Test-Path $f) { Remove-Item $f -Force } }
  if (Test-Path $BridgeCopy) { Remove-Item $BridgeCopy -Recurse -Force }
  $claude = Get-Command claude -ErrorAction SilentlyContinue
  if ($claude) { Remove-Mcp $claude.Source }
  Write-Host "PagePatch 연결 프로그램 등록을 해제했습니다. ($Data 의 기록 파일은 남겨 둡니다)"
  exit 0
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js 가 없습니다. https://nodejs.org 에서 22 이상을 설치하세요." }
$nodeMajor = [int]((& $node.Source -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 22) { throw "Node.js 22 이상이 필요합니다 (지금 $nodeMajor)." }

$claude = Get-Command claude -ErrorAction SilentlyContinue
$claudePath = if ($claude) { $claude.Source } else { $null }
if (-not $claudePath) {
  $guess = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
  if (Test-Path $guess) { $claudePath = $guess }
}

New-Item -ItemType Directory -Force $Data | Out-Null

# 확장 폴더(Edge 가 관리)에서 실행됐으면 복사본을 쓴다. 개발자 모드(소스 폴더)면 그 자리 그대로
if ($Here -like "*\Extensions\*") {
  if (Test-Path $BridgeCopy) { Remove-Item $BridgeCopy -Recurse -Force }
  New-Item -ItemType Directory -Force $BridgeCopy | Out-Null
  Copy-Item (Join-Path $Here "*") $BridgeCopy -Recurse -Force
  $Here = $BridgeCopy
}

Write-Utf8 (Join-Path $Data "config.json") (@{ node = $node.Source; claude = $claudePath } | ConvertTo-Json)
Write-Utf8 $Cmd "@echo off`r`n`"$($node.Source)`" `"$(Join-Path $Here 'host.mjs')`" %*`r`n"
$origins = $ExtensionIds | ForEach-Object { "chrome-extension://$_/" }
Write-Utf8 $Manifest (@{
  name = $HostName
  description = "PagePatch - Claude Code bridge"
  path = $Cmd
  type = "stdio"
  allowed_origins = @($origins)
} | ConvertTo-Json)

foreach ($k in $RegKeys) {
  New-Item -Path $k -Force | Out-Null
  Set-ItemProperty -Path $k -Name "(default)" -Value $Manifest
}

Write-Host "등록했습니다."
Write-Host "  node   : $($node.Source)"
if ($claudePath) { Write-Host "  claude : $claudePath" } else { Write-Host "  claude : 찾지 못함 - Claude Code 를 설치한 뒤 이 스크립트를 다시 실행하세요" -ForegroundColor Yellow }
Write-Host "  호스트 : $Manifest"
Write-Host "  파일   : $Here"

if ($WithMcp) {
  if (-not $claudePath) { throw "claude 가 없어 터미널 등록을 건너뜁니다." }
  Remove-Mcp $claudePath
  & $claudePath mcp add --scope user pagepatch -- $node.Source (Join-Path $Here "mcp.mjs")
  Write-Host "터미널 claude 에 pagepatch MCP 서버를 등록했습니다."
}

Write-Host ""
Write-Host "이제 PagePatch 설정 → Claude Code → '연결 사용'을 켜고 '다시 확인'을 누르세요."
