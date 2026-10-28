# Mídia sintética local: sem APIs, downloads ou direitos de terceiros.
param([string]$Name = 'authorized-speech')
$ErrorActionPreference = 'Stop'
if ($Name -notmatch '^[a-zA-Z0-9_-]{1,100}$') { throw 'Use apenas letras, números, hífen e sublinhado no nome.' }
$fixtureRoot = Join-Path $PSScriptRoot '../media/fixtures'
New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null
$videoPath = Join-Path $fixtureRoot "$Name.mp4"
$audioPath = Join-Path $fixtureRoot "$Name.wav"
if ((Test-Path -LiteralPath $videoPath) -or (Test-Path -LiteralPath $audioPath)) { throw 'Fixture já existe. Escolha outro -Name para preservar os arquivos.' }
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $installed = @($voice.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo })
    $selected = $installed | Where-Object { $_.Culture.Name -eq 'en-US' } | Select-Object -First 1
    if ($selected) {
        $text = 'This is a local test for Auto Clips. We create short videos using authorized content. The system transcribes speech and prepares vertical clips.'
    } else {
        $selected = $installed | Where-Object { $_.Culture.Name -like 'pt-*' } | Select-Object -First 1
        $text = 'Este é um teste local para o Auto Clips. Nós criamos vídeos curtos usando conteúdo autorizado. O sistema transcreve a fala e prepara cortes verticais.'
    }
    if (!$selected) { throw 'Instale ou habilite uma voz existente em português ou inglês para gerar fala compreensível.' }
    $voice.SelectVoice($selected.Name)
    $voice.SetOutputToWaveFile($audioPath)
    $voice.Speak($text)
} finally { $voice.Dispose() }
ffmpeg -hide_banner -loglevel error -n -f lavfi -i 'testsrc2=size=640x360:rate=24' -i $audioPath -shortest -c:v libx264 -threads 2 -pix_fmt yuv420p -c:a aac $videoPath
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg falhou ao gerar fixture' }
Write-Output "Fixture sintética criada em media/fixtures/$Name.mp4. Voz: $($selected.Culture.Name). Não versionar os arquivos."
