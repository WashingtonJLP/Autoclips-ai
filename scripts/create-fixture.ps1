# Mídia sintética local: sem APIs, downloads ou direitos de terceiros.
param([string]$Name = 'authorized-speech', [ValidateSet('basic', 'semantic')][string]$Profile = 'basic')
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
    if ($Profile -eq 'semantic') {
        if ($selected.Culture.Name -eq 'en-US') {
            $text = 'Why does checking your phone make it harder to finish a simple task? Every interruption forces your brain to rebuild the context of what you were doing. Try turning off notifications for twenty minutes and write down the single task you want to finish. At the end, compare how much you completed with a normal distracted session. This is a small experiment, not a promise that every productivity problem will disappear. Here is a funny mistake I made while testing this idea. I put my phone in another room, then used my watch to check the same notifications. Moving a distraction does not help if you bring its remote control along. The useful lesson is to change the habit, not just the location of the device. Another lesson came from learning a difficult piano passage. I kept repeating the whole song and making the same mistake. Then I practiced only the difficult transition slowly for five minutes. For the first time, I could hear the difference between repeating a mistake and practicing a solution. Small focused experiments can reveal which part of a problem actually needs your attention.'
        } else {
            $text = 'Por que olhar o celular dificulta terminar uma tarefa simples? Cada interrupção obriga o cérebro a reconstruir o contexto do que você estava fazendo. Experimente desligar as notificações durante vinte minutos e escrever a única tarefa que deseja concluir. Depois compare o resultado com uma sessão cheia de distrações. Isso é um pequeno experimento, não uma promessa de resolver todo problema de produtividade. Cometi um erro engraçado ao testar essa ideia. Deixei o celular em outro cômodo, mas usei o relógio para ler as mesmas notificações. Mudar uma distração de lugar não ajuda quando você leva o controle remoto junto. A lição útil é mudar o hábito, não apenas o lugar do aparelho. Aprendi outra lição ao estudar uma passagem difícil no piano. Eu repetia a música inteira e cometia o mesmo erro. Então pratiquei apenas a transição difícil, devagar, por cinco minutos. Pela primeira vez percebi a diferença entre repetir um erro e praticar uma solução. Pequenos experimentos podem revelar qual parte de um problema realmente precisa da sua atenção.'
        }
    }
    $voice.SelectVoice($selected.Name)
    $voice.SetOutputToWaveFile($audioPath)
    $voice.Speak($text)
} finally { $voice.Dispose() }
ffmpeg -hide_banner -loglevel error -n -f lavfi -i 'testsrc2=size=640x360:rate=24' -i $audioPath -shortest -c:v libx264 -threads 2 -pix_fmt yuv420p -c:a aac $videoPath
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg falhou ao gerar fixture' }
Write-Output "Fixture sintética criada em media/fixtures/$Name.mp4. Voz: $($selected.Culture.Name). Não versionar os arquivos."
