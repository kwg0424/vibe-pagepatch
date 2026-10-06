# PagePatch - Claude Code bridge one-line setup (for store installs; no need to clone the repo).
#   irm https://raw.githubusercontent.com/kwg0424/vibe-pagepatch/main/bridge/setup.ps1 | iex
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/kwg0424/vibe-pagepatch/main/bridge/setup.ps1))) -WithMcp
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/kwg0424/vibe-pagepatch/main/bridge/setup.ps1))) -Uninstall
#
# 1. Downloads the bridge files from GitHub main into %LOCALAPPDATA%\PagePatch\bridge\ (re-run to update)
# 2. Runs the downloaded install.ps1 (-WithMcp / -Uninstall are passed through)
#
# Keep this file ASCII only, without BOM: Windows PowerShell 5.1 irm mis-decodes UTF-8,
# so Korean text or a BOM breaks the script when piped to iex. install.ps1 is saved as raw bytes, so it may use Korean.
param([switch]$WithMcp, [switch]$Uninstall)
$ErrorActionPreference = "Stop"

$Base = "https://raw.githubusercontent.com/kwg0424/vibe-pagepatch/main/bridge"
$Files = @("install.ps1", "host.mjs", "mcp.mjs", "ws.mjs", "common.mjs", "tooldefs.mjs", "SKILL.md")
$Dir = Join-Path $env:LOCALAPPDATA "PagePatch\bridge"

if ($Uninstall) {
  $installer = Join-Path $Dir "install.ps1"
  if (Test-Path $installer) { & powershell -NoProfile -ExecutionPolicy Bypass -File $installer -Uninstall }
  if (Test-Path $Dir) { Remove-Item $Dir -Recurse -Force }
  return # exit would close the user's PowerShell window when run through iex
}

# Windows PowerShell 5.1 may not enable TLS 1.2 by default
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

New-Item -ItemType Directory -Force $Dir | Out-Null
foreach ($f in $Files) {
  Write-Host "Downloading $f"
  Invoke-WebRequest -UseBasicParsing "$Base/$f" -OutFile (Join-Path $Dir $f)
}

$installArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $Dir "install.ps1"))
if ($WithMcp) { $installArgs += "-WithMcp" }
& powershell @installArgs
if ($LASTEXITCODE) { throw "PagePatch bridge setup failed (see the message above)." }
