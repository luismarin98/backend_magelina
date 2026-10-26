param([switch]$RenderStopped)
$ErrorActionPreference = 'Stop'
if (!$RenderStopped) { throw 'Suspende primero el servicio de Render. Ejecuta: npm run host:pc -- -RenderStopped' }
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class MagelinaAwake {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint flags);
}
'@
# Evita la suspension durante esta sesion; no modifica el plan de energia.
if ([MagelinaAwake]::SetThreadExecutionState([uint32]2147483649) -eq 0) { throw 'No se pudo mantener despierto el equipo.' }
Push-Location (Join-Path $PSScriptRoot '..')
try {
    & node scripts/host-pc.mjs start --render-stopped
    $hostExitCode = $LASTEXITCODE
} finally {
    [void][MagelinaAwake]::SetThreadExecutionState([uint32]2147483648)
    Pop-Location
}
exit $hostExitCode
