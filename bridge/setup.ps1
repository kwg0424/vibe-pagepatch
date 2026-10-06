# PagePatch Claude Code 연결 프로그램 한 줄 설치 (스토어에서 받은 PC 용. 저장소를 받을 필요 없음).
#   irm https://raw.githubusercontent.com/kwg0424/vibe-pagepatch/main/bridge/setup.ps1 | iex
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/kwg0424/vibe-pagepatch/main/bridge/setup.ps1))) -WithMcp
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/kwg0424/vibe-pagepatch/main/bridge/setup.ps1))) -Uninstall
#
# 하는 일
#   1. GitHub main 의 bridge 파일을 %LOCALAPPDATA%\PagePatch\bridge\ 로 받는다 (다시 실행하면 최신으로 바뀜)
#   2. 받은 install.ps1 을 실행해 등록한다 (-WithMcp · -Uninstall 은 그대로 넘김)
param([switch]$WithMcp, [switch]$Uninstall)
$ErrorActionPreference = "Stop"

$Base = "https://raw.githubusercontent.com/kwg0424/vibe-pagepatch/main/bridge"
$Files = @("install.ps1", "host.mjs", "mcp.mjs", "ws.mjs", "common.mjs", "tooldefs.mjs", "SKILL.md")
$Dir = Join-Path $env:LOCALAPPDATA "PagePatch\bridge"

if ($Uninstall) {
  $installer = Join-Path $Dir "install.ps1"
  if (Test-Path $installer) { & powershell -NoProfile -ExecutionPolicy Bypass -File $installer -Uninstall }
  if (Test-Path $Dir) { Remove-Item $Dir -Recurse -Force }
  return # iex 로 돌 때 exit 를 쓰면 사용자의 PowerShell 창이 닫힌다
}

# Windows PowerShell 5.1 기본값엔 TLS 1.2 가 빠져 있을 수 있다
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

New-Item -ItemType Directory -Force $Dir | Out-Null
foreach ($f in $Files) {
  Write-Host "받는 중: $f"
  Invoke-WebRequest -UseBasicParsing "$Base/$f" -OutFile (Join-Path $Dir $f)
}

$args2 = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $Dir "install.ps1"))
if ($WithMcp) { $args2 += "-WithMcp" }
& powershell @args2
if ($LASTEXITCODE) { throw "등록하지 못했습니다 (위 메시지 확인)." }
