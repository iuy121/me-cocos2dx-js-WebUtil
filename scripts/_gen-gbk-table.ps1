# Offline generator for the GBK(cp936) double-byte table used by lib/gbk.js.
# ASCII-only on purpose: PowerShell 5.1 reads BOM-less .ps1 as ANSI, so any
# non-ASCII byte here would break parsing.
# Run manually only when the table rules change:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/_gen-gbk-table.ps1
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$outPath = Join-Path $root "lib\gbk-table.txt"

# Exception fallback instead of the default replacement fallback: '?' is itself a
# valid character, so a silent replacement would be indistinguishable from a real hit.
$enc = [System.Text.Encoding]::GetEncoding(
  936,
  [System.Text.EncoderFallback]::ExceptionFallback,
  [System.Text.DecoderFallback]::ExceptionFallback
)

$lines = New-Object System.Collections.Generic.List[string]
$mapped = 0
$unmapped = 0

for ($lead = 0x81; $lead -le 0xFE; $lead++) {
  $sb = New-Object System.Text.StringBuilder
  for ($trail = 0x40; $trail -le 0xFE; $trail++) {
    $ch = [char]0xFFFD
    try {
      $s = $enc.GetString([byte[]]@($lead, $trail))
      if ($s.Length -eq 1) { $ch = $s[0] }
    } catch {
      $ch = [char]0xFFFD
    }
    if ($ch -eq [char]0xFFFD) { $unmapped++ } else { $mapped++ }
    [void]$sb.Append($ch)
  }
  $lines.Add(("{0:X2}`t{1}" -f $lead, $sb.ToString()))
}

[System.IO.File]::WriteAllLines($outPath, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("gbk-table.txt done mapped={0} unmapped={1} lines={2}" -f $mapped, $unmapped, $lines.Count)
