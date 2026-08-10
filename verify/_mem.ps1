Get-Process |
  Sort-Object WS -Descending |
  Select-Object -First 10 Name, @{ N = 'MB'; E = { [math]::Round($_.WS / 1MB) } } |
  Format-Table -AutoSize |
  Out-String -Width 60
