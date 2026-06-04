# Encerra apenas processos node.exe que estão ESCUTANDO na porta 3001
$porta = 3001

$conexoes = Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -gt 0 }

if (-not $conexoes) {
  Write-Host "Nenhum servidor escutando na porta $porta. Pode rodar: node server.js"
  exit 0
}

$pids = $conexoes | Select-Object -ExpandProperty OwningProcess -Unique

foreach ($procId in $pids) {
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if (-not $proc) {
    Write-Host "PID $procId ja foi encerrado."
    continue
  }
  if ($proc.ProcessName -ne 'node') {
    Write-Host "Porta $porta usada por $($proc.ProcessName) (PID $procId). Feche esse programa manualmente."
    continue
  }
  Stop-Process -Id $procId -Force
  Write-Host "Encerrado: node.exe (PID $procId)"
}

Start-Sleep -Seconds 1
$ainda = Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue
if ($ainda) {
  Write-Host "A porta $porta ainda esta ocupada. Tente fechar outras janelas do terminal ou reinicie o PC."
} else {
  Write-Host "Porta $porta livre. Agora rode: node server.js"
}
