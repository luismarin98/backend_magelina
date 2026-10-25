$ErrorActionPreference = 'Stop'
$toolDirectory = Join-Path $PSScriptRoot '../.tools'
New-Item -ItemType Directory -Path $toolDirectory -Force | Out-Null
$toolPath = Join-Path $toolDirectory 'yt-dlp.exe'
$version = '2026.10.21'
$expectedHash = '33121d192d706e62f684a06f80918e3f3a8ba52ac3a65213b6951c39c7d9f555'
if (!(Test-Path -LiteralPath $toolPath) -or (Get-FileHash -LiteralPath $toolPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
  $downloadPath = Join-Path $toolDirectory 'yt-dlp.download'
  Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/download/$version/yt-dlp.exe" -OutFile $downloadPath
  if ((Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'La suma SHA-256 de yt-dlp no coincide. No se instalará el archivo.' }
  Move-Item -LiteralPath $downloadPath -Destination $toolPath -Force
}
Write-Output "yt-dlp $version instalado y verificado en $toolPath"
