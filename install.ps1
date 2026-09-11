# Install or update Rowset Studio for the current user (Windows).
#
#   irm https://raw.githubusercontent.com/dbaopsio/rowset-studio/main/install.ps1 | iex
#
# $env:ROWSET_VERSION selects a release, e.g. 0.0.13 (default: the latest).
# Uninstall (your connections and notebooks are kept):
#   $env:ROWSET_UNINSTALL = 1; irm https://raw.githubusercontent.com/dbaopsio/rowset-studio/main/install.ps1 | iex

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo = 'dbaopsio/rowset-studio'
$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Rowset Studio'
$Exe = Join-Path $InstallDir 'rowset.exe'
$Shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Rowset Studio.lnk'

function Stop-Rowset {
    if (Test-Path $Exe) {
        try { & $Exe desktop-stop *> $null } catch { }
    }
}

function Set-UserPath([string]$Directory, [bool]$Present) {
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @(($current -split ';') | Where-Object { $_ -and ($_ -ne $Directory) })
    if ($Present) { $parts += $Directory }
    [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
}

if ($env:ROWSET_UNINSTALL) {
    Stop-Rowset
    Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $Shortcut -Force -ErrorAction SilentlyContinue
    Set-UserPath $InstallDir $false
    Write-Host "Rowset Studio removed. Your data in $env:APPDATA\Rowset was kept."
    return
}

$machine = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
switch ($machine) {
    'AMD64' { $arch = 'amd64' }
    'ARM64' { $arch = 'arm64' }
    default { throw "Rowset Studio does not support the $machine processor." }
}

if ($env:ROWSET_DOWNLOAD_BASE) {
    $base = $env:ROWSET_DOWNLOAD_BASE
} elseif ($env:ROWSET_VERSION) {
    $base = "https://github.com/$Repo/releases/download/v$($env:ROWSET_VERSION.TrimStart('v'))"
} else {
    $base = "https://github.com/$Repo/releases/latest/download"
}

$name = "rowset-studio-windows-$arch"
$asset = "$name.zip"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("rowset-install-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Write-Host "Downloading $asset..."
    $zip = Join-Path $tmp $asset
    $sums = Join-Path $tmp 'SHA256SUMS'
    Invoke-WebRequest -Uri "$base/$asset" -OutFile $zip -UseBasicParsing
    Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile $sums -UseBasicParsing

    $line = Get-Content $sums | Where-Object { $_ -match ('\s\*?' + [regex]::Escape($asset) + '$') } | Select-Object -First 1
    if (-not $line) { throw "No checksum for $asset." }
    $expected = ($line -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -ne $actual) { throw "Checksum mismatch for $asset." }

    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    Stop-Rowset
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item -Path (Join-Path $tmp "$name\*") -Destination $InstallDir -Recurse -Force
    Set-UserPath $InstallDir $true

    # The shortcut starts the local server without a console window.
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Shortcut)
    $link.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $link.Arguments = "-NoProfile -WindowStyle Hidden -Command `"& '$Exe' desktop`""
    $link.WorkingDirectory = $InstallDir
    $link.Description = 'Rowset Studio'
    $link.Save()

    $version = & $Exe --version
    Write-Host "Installed $version to $InstallDir."
    Write-Host 'Open Rowset Studio from the Start menu, or run rowset in a new terminal.'
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
