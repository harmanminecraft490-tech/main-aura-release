Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('C:\Users\mayra nijhawan\Aura(ai)\releases\release-current.zip')
Write-Host ('Total entries: ' + $zip.Entries.Count)

$names = $zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') }

$expected = @(
  'aura-ai/package.json',
  'aura-ai/src/electron/main.ts',
  'aura-ai/src/electron/providers.ts',
  'aura-ai/releases/Aura-vNext/package.json',
  'aura-ai/releases/Aura-vNext/backend/chat-orchestrator.ts',
  'aura-ai/releases/Aura-vNext/models/aura-models/definitions.ts',
  'aura-ai/releases/Aura-vNext/providers/streaming/sse.ts',
  'aura-ai/releases/Aura-vNext/ui/chat/ChatView.tsx',
  'aura-ai/releases/release-2026-07-15/README.md',
  'aura-ai/releases/release-2026-07-15/PROJECT_STATUS.md',
  'aura-ai/releases/release-2026-07-15/CHANGELOG.md',
  'aura-ai/releases/release-2026-07-15/TODO.md',
  'aura-ai/releases/release-2026-07-15/DEPENDENCIES.md',
  'aura-ai/releases/release-2026-07-15/ENVIRONMENT.md',
  'aura-ai/releases/release-2026-07-15/PROJECT_TREE.txt',
  'aura-ai/releases/release-2026-07-15/BUILD_INFO.json'
)

$missing = 0
foreach ($e in $expected) {
  if ($names -contains $e) { Write-Host ("OK   " + $e) }
  else { Write-Host ("MISS " + $e); $missing++ }
}

$leaks = @($names | Where-Object { $_ -like '*node_modules*' -or $_ -like '*win-unpacked*' -or $_ -like 'aura-ai/dist/*' -or $_ -like 'aura-ai/release/*' })
Write-Host ("Missing expected files: " + $missing)
Write-Host ("Excluded-dir leaks: " + $leaks.Count)
$zip.Dispose()
