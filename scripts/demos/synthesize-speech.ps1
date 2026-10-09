param(
  [Parameter(Mandatory = $true)]
  [string]$InputTextFile,

  [Parameter(Mandatory = $true)]
  [string]$OutputAudioFile,

  [string]$VoiceName = "Microsoft Maria Desktop",

  [int]$Rate = -1
)

Add-Type -AssemblyName System.Speech

$text = Get-Content -LiteralPath $InputTextFile -Raw -Encoding UTF8
if ([string]::IsNullOrWhiteSpace($text)) {
  throw "Arquivo de narracao vazio: $InputTextFile"
}

$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.Rate = $Rate

$availableVoices = $speaker.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
if ($availableVoices -contains $VoiceName) {
  $speaker.SelectVoice($VoiceName)
}

$outDir = Split-Path -Parent $OutputAudioFile
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$speaker.SetOutputToWaveFile($OutputAudioFile)
$speaker.Speak($text)
$speaker.Dispose()
