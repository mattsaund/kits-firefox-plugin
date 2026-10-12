# Installs (or with -Uninstall, removes) the Kits Editor for Firefox helper for
# the current user on Windows.
#
#   irm https://github.com/mattsaund/kits-firefox-plugin/releases/latest/download/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://github.com/mattsaund/kits-firefox-plugin/releases/latest/download/install.ps1))) -Uninstall
#
# Run from a checkout it installs the helper next to it; piped from irm it
# downloads the helper from the latest release. The helper is copied to its own
# folder and registered with Firefox under HKCU\Software\Mozilla\NativeMessagingHosts.
# Firefox profiles aren't touched here; the extension does that when you press Apply.
#
# Written for Windows PowerShell 5.1. Errors throw instead of calling exit,
# because exit would close the window of someone running this through iex.
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Name = "autohide_tab_bar"
$ExtensionId = "autohide-tab-bar@kits"
$HostFile = "autohide_tab_bar_host.py"
$Download = "https://github.com/mattsaund/kits-firefox-plugin/releases/latest/download"
$InstallDir = Join-Path $env:LOCALAPPDATA "AutoHideTabBar"
$RegistryKey = "HKCU:\Software\Mozilla\NativeMessagingHosts\$Name"

if ($Uninstall) {
  Remove-Item -Path $RegistryKey -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Removed the Kits Editor for Firefox helper."
  Write-Host 'To take the styling out of Firefox, use "Remove from Firefox" in the extension first.'
  return
}

# Firefox starts the helper without a console, so pin the full path of a real
# Python 3.8+ now. The "python" Microsoft Store alias prints nothing useful and
# is skipped.
function Find-Python {
  foreach ($candidate in @("py -3", "python3", "python")) {
    $parts = $candidate -split " "
    $extra = @($parts | Select-Object -Skip 1)
    if (-not (Get-Command $parts[0] -ErrorAction SilentlyContinue)) { continue }
    try {
      $found = & $parts[0] @extra -c "import sys; print(sys.executable if sys.version_info >= (3, 8) else '')" 2>$null
    } catch {
      continue
    }
    if ($LASTEXITCODE -eq 0 -and $found -and (Test-Path ($found.Trim()))) { return $found.Trim() }
  }
  return $null
}

$Python = Find-Python
if (-not $Python) {
  throw "Python 3.8 or newer is required but was not found. Install it from https://www.python.org/downloads/ (or: winget install Python.Python.3.13), then run this again."
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$Target = Join-Path $InstallDir $HostFile

# Run as a file from a checkout: use the helper beside it. Through iex there is
# no script path, so download it from the latest release.
$Local = $null
if ($PSScriptRoot) { $Local = Join-Path $PSScriptRoot $HostFile }
if ($Local -and (Test-Path $Local)) {
  Copy-Item $Local $Target -Force
} else {
  Invoke-WebRequest -UseBasicParsing -Uri "$Download/$HostFile" -OutFile "$Target.download"
  Move-Item "$Target.download" $Target -Force
}

# Firefox runs the launcher; it hands stdin/stdout straight to Python. The
# script path comes from %~dp0 at run time, and the file is written in the
# console code page cmd.exe reads batch files in, so accented user names work.
$Launcher = Join-Path $InstallDir "$Name.bat"
$OemEncoding = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
$Batch = "@echo off`r`n`"$Python`" `"%~dp0$HostFile`" %*`r`n"
[IO.File]::WriteAllText($Launcher, $Batch, $OemEncoding)

$ManifestPath = Join-Path $InstallDir "$Name.json"
$Manifest = [ordered]@{
  name = $Name
  description = "Kits Editor for Firefox helper: installs the extension's userChrome stylesheet"
  path = $Launcher
  type = "stdio"
  allowed_extensions = @($ExtensionId)
} | ConvertTo-Json
[IO.File]::WriteAllText($ManifestPath, $Manifest, (New-Object Text.UTF8Encoding $false))

New-Item -Path $RegistryKey -Force | Out-Null
Set-Item -Path $RegistryKey -Value $ManifestPath

# (No double quotes inside the code: Windows PowerShell 5.1 mangles them in
# arguments to native programs, hence \x22.)
$Version = & $Python -c "import re, sys; print(re.search(r'^VERSION = \x22(.+)\x22', open(sys.argv[1], encoding='utf-8').read(), re.M).group(1))" $Target
Write-Host "Installed the Kits Editor for Firefox helper $Version."
Write-Host "Reopen the extension's settings page and it will connect."
