# Mídia sintética local: sem APIs, downloads ou direitos de terceiros.
$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path $PSScriptRoot '../media/fixtures'
New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voice.SetOutputToWaveFile((Join-Path $fixtureRoot 'speech.wav'))
    $voice.Speak('This is a local test for Auto Clips. We create short videos using authorized content. The system transcribes speech and prepares vertical clips.')
} finally { $voice.Dispose() }
ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=640x360:rate=24' -i (Join-Path $fixtureRoot 'speech.wav') -shortest -c:v libx264 -threads 2 -pix_fmt yuv420p -c:a aac (Join-Path $fixtureRoot 'sample.mp4')
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg falhou ao gerar fixture' }
Write-Output 'Fixture sintética criada em media/fixtures. Não versionar os arquivos.'
