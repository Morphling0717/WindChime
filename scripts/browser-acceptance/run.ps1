param(
  [Parameter(Mandatory=$true)][ValidateSet('open','basic','network')][string]$Phase,
  [Parameter(Mandatory=$true)][string]$Fixtures,
  [Parameter(Mandatory=$true)][string]$Report,
  [ValidatePattern('^[A-Za-z0-9_-]+$')][string]$Task = 'windchime-acceptance'
)
$ErrorActionPreference = 'Stop'
if ($env:WINDCHIME_SMOKE_ALLOW_WRITES -ne '1' -or !$env:WINDCHIME_SMOKE_PASSWORD) { throw 'Requires explicit disposable-site opt-in and password.' }
$config = Get-Content -LiteralPath $Fixtures -Raw
foreach ($fixture in @($config | ConvertFrom-Json)) {
  if (([Uri]$fixture.base).Host -notin @('localhost','127.0.0.1')) { throw 'Only disposable loopback sites are allowed.' }
}
$passwordJson = ConvertTo-Json -InputObject $env:WINDCHIME_SMOKE_PASSWORD -Compress
$source = "globalThis.wcFixtures = $config; globalThis.wcTestPassword = $passwordJson;`n" + (Get-Content -LiteralPath (Join-Path $PSScriptRoot "$Phase.js") -Raw)
$program = [IO.Path]::GetTempFileName()
$cli = "$env:LOCALAPPDATA\Tabbit\LocalAgent\bin\tabbit-cli.exe"
$request = "$Phase-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
try {
  [IO.File]::WriteAllText($program, $source, [Text.UTF8Encoding]::new($false))
  $lines = cmd.exe /d /c "`"$cli`" nodejs --task $Task --request-id $request --timeout-ms 180000 < `"$program`""
  $receipt = ($lines | Where-Object { $_ -like '{*' } | Select-Object -Last 1) | ConvertFrom-Json
  if ($receipt.status -ne 'succeeded') {
    throw "Browser phase $Phase did not succeed; request=$request. Inspect the receipt and visible state before retrying. $($receipt.result.error)"
  }
  # Persist only the bounded test report, never transition URLs or display grants.
  $value = $receipt.result.value
  [IO.File]::WriteAllText([IO.Path]::GetFullPath($Report), ($value | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
  Write-Output "$Phase passed; report saved to $Report"
} finally { Remove-Item -LiteralPath $program -ErrorAction SilentlyContinue }
