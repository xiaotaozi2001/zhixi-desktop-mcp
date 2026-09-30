param(
  [string]$Executable = 'C:\Program Files\ZhiXi\ZXMind\zhiximind-desktop.exe',
  [ValidateRange(1024,65535)][int]$Port = 19222,
  [string[]]$ShortcutPaths = @(
    'C:\Users\Public\Desktop\知犀思维导图.lnk',
    'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\ZhiXi\ZXMind\知犀思维导图.lnk'
  ),
  [switch]$Apply,
  [switch]$InstallForUser
)
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$backupDir = Join-Path $PSScriptRoot '.state\shortcut-backups'
$results = @()
if ($InstallForUser) {
  $ShortcutPaths = @((Join-Path ([Environment]::GetFolderPath('Desktop')) '知犀思维导图（自动连接）.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'ZhiXi MCP\知犀思维导图（自动连接）.lnk'))
}
foreach ($shortcutPath in $ShortcutPaths) {
  $full = [IO.Path]::GetFullPath($shortcutPath)
  if ([IO.Path]::GetExtension($full) -ne '.lnk') { throw 'Only .lnk shortcuts are supported.' }
  $exists = Test-Path -LiteralPath $full
  if (-not $exists -and -not $InstallForUser) { continue }
  $shortcut = $shell.CreateShortcut($full)
  if ($exists -and $shortcut.TargetPath -ine $Executable) { throw "Unexpected target: $full" }
  $before = $shortcut.Arguments
  $clean = [regex]::Replace($before, '--remote-debugging-(?:address|port)(?:=|\s+)(?:"[^"]*"|\S+)', '').Trim()
  $after = ($clean + " --remote-debugging-address=127.0.0.1 --remote-debugging-port=$Port").Trim()
  $changed = $before -cne $after
  $backup = $null
  if ($Apply -and $changed) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $backup = Join-Path $backupDir (([guid]::NewGuid().ToString()) + '.lnk')
    if ($exists) { Copy-Item -LiteralPath $full -Destination $backup } else { $backup=$null }
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($full)) -Force | Out-Null
    $shortcut.TargetPath = $Executable
    $shortcut.WorkingDirectory = [IO.Path]::GetDirectoryName($Executable)
    $shortcut.IconLocation = "$Executable,0"
    $shortcut.Arguments = $after
    $shortcut.Save()
    if ($shell.CreateShortcut($full).Arguments -cne $after) { throw "Shortcut verification failed: $full" }
  }
  $results += [pscustomobject]@{ path=$full; before=$before; after=$after; changed=$changed; applied=[bool]$Apply; backup=$backup }
}
if ($Apply -and $results.Count) {
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
  $results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $backupDir ('changes-' + [guid]::NewGuid().ToString() + '.json')) -Encoding UTF8
}
$results | ConvertTo-Json -Depth 4
