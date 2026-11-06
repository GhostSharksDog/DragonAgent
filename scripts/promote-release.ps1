$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
function WorkspacePath([string] $relative) {
  $resolved = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
  if (-not $resolved.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Path outside workspace: $resolved" }
  return $resolved
}
$source = WorkspacePath "release/$version/win-unpacked"
$target = WorkspacePath 'release/win-unpacked'
$report = Get-Content -LiteralPath (WorkspacePath 'test-results/release-check.json') -Raw | ConvertFrom-Json
if ($report.version -ne $version -or $report.prohibited.Count -ne 0 -or -not $report.compiledCodeMatches) { throw 'Run release-check.mjs before promotion.' }
$manifest = Get-Content -LiteralPath (Join-Path $source 'resources/app/package.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $version) { throw 'Release version mismatch.' }
$running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase) -or $_.ExecutablePath.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase)) })
if ($running.Count) { throw 'DragonAgent is still running. Finish tasks and exit it before promotion.' }
# Read only the existing app's state; never print credentials or write to its database.
$idleCheck = @'
const {DatabaseSync}=require('node:sqlite'); const path=require('node:path'); const fs=require('node:fs');
const filename=path.join(process.env.APPDATA,'DragonAgent','dragonagent.db');
if(fs.existsSync(filename)){ const db=new DatabaseSync(filename,{readOnly:true}); const row=db.prepare('SELECT json FROM app_state WHERE id=1').get(); const state=row?JSON.parse(row.json):{}; db.close(); if((state.sessions||[]).some(s=>['running','waiting','stopping'].includes(s.status)))throw Error('Existing app state contains unfinished tasks; review before promotion.'); }
const workshopFile=path.join(process.env.APPDATA,'DragonAgent','workshop','workshop.db');
if(fs.existsSync(workshopFile)){ const db=new DatabaseSync(workshopFile,{readOnly:true}); const projects=db.prepare('SELECT json FROM projects').all().map(row=>JSON.parse(row.json)); db.close(); if(projects.some(p=>p.assistant?.status==='running'||p.download?.state==='running'||['character','queued','running','stopping'].includes(p.status)||p.operation))throw Error('Creative Studio has an active or unresolved generation task; finish or resolve it before promotion.'); }
const studioFile=path.join(process.env.APPDATA,'DragonAgent','studio','studio.db');
if(fs.existsSync(studioFile)){ const db=new DatabaseSync(studioFile,{readOnly:true}); const row=db.prepare('SELECT json FROM state WHERE id=1').get(); db.close(); const state=row?JSON.parse(row.json):{}; const projects=state.projects||[]; if(projects.some(p=>['running','character'].includes(p.status)||(p.operations||[]).some(o=>['submitting','submitted','unknown','download','processing'].includes(o.state))))throw Error('Cloud pet studio has an unfinished or unknown operation; resolve it before promotion.'); }
'@
& node -e $idleCheck
if ($LASTEXITCODE -ne 0) { throw 'Could not confirm the existing app is idle.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = WorkspacePath ".cache/promote-$version-$stamp"
Copy-Item -LiteralPath $source -Destination $stage -Recurse
foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse) {
  $relative = [IO.Path]::GetRelativePath($source, $file.FullName)
  if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath (Join-Path $stage $relative)).Hash) { throw "Copy hash mismatch: $relative" }
}
$backup = $null
if (Test-Path -LiteralPath $target) {
  $oldVersion = (Get-Content -LiteralPath (Join-Path $target 'resources/app/package.json') -Raw | ConvertFrom-Json).version
  if ($oldVersion -notmatch '^\d+\.\d+\.\d+[-\w.]*$') { throw 'Invalid previous version.' }
  $backup = WorkspacePath ".cache/legacy-release-$oldVersion-$stamp"
  Move-Item -LiteralPath $target -Destination $backup
}
try { Move-Item -LiteralPath $stage -Destination $target }
catch { if ($backup -and -not (Test-Path -LiteralPath $target)) { Move-Item -LiteralPath $backup -Destination $target }; throw }
@{ version=$version; entry=(Join-Path $target 'DragonAgent.exe'); previousReleaseBackup=$backup; appDataPreserved=$true; allFilesHashVerified=$true; promotedAt=(Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (WorkspacePath 'test-results/promotion.json') -Encoding utf8
Write-Output "Promoted $version to $target"
Write-Output "Previous release backup: $backup"
