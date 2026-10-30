# Execução única autorizada após renovação natural; sem polling ou retries.
$ErrorActionPreference = 'Stop'
$diagnosticRoot = Split-Path -Parent $PSScriptRoot
$diagnosticDue = [DateTimeOffset]::Parse('2026-10-31T00:01:00Z')
if ([DateTimeOffset]::UtcNow -lt $diagnosticDue) {
    throw 'Teste JSON ainda não liberado pelo horário de renovação.'
}
Push-Location -LiteralPath $diagnosticRoot
try {
    $diagnosticArtifacts = Join-Path $diagnosticRoot 'artifacts'
    New-Item -ItemType Directory -Path $diagnosticArtifacts -Force | Out-Null
    $diagnosticLog = Join-Path $diagnosticArtifacts 'gemini-json-minimo-agendado.log'
    function Invoke-DiagnosticDocker {
        param([string[]]$DockerArguments)
        $diagnosticPreference = $ErrorActionPreference
        try {
            # Docker usa stderr também para progresso; avaliar o código de saída.
            $ErrorActionPreference = 'Continue'
            & docker @DockerArguments 2>&1 | Out-File -LiteralPath $diagnosticLog -Append -Encoding utf8
            $diagnosticExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $diagnosticPreference
        }
        if ($diagnosticExitCode -ne 0) {
            throw 'Comando Docker falhou; verificar log e ledger antes de qualquer nova tentativa.'
        }
    }
    Invoke-DiagnosticDocker @('compose', 'cp', 'apps/api/dist/selection/diagnostics.js', 'api:/app/apps/api/dist/selection/diagnostics.js')
    Invoke-DiagnosticDocker @('compose', 'cp', 'scripts/gemini-progressive-diagnostic.cjs', 'api:/app/scripts/gemini-progressive-diagnostic.cjs')
    # O próprio roteiro consulta/reserva o ledger antes do único fetch permitido.
    Invoke-DiagnosticDocker @('compose', 'exec', '-T', 'api', 'node', 'scripts/gemini-progressive-diagnostic.cjs', '--live-json')
    Invoke-DiagnosticDocker @('compose', 'cp', 'api:/tmp/gemini-progressive/report.json', 'artifacts/gemini-json-minimo-resultado.json')
    Invoke-DiagnosticDocker @('compose', 'cp', 'api:/tmp/gemini-progressive/payloads.json', 'artifacts/gemini-json-minimo-payloads-agendado.json')
} finally {
    Pop-Location
}
