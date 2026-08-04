$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repositoryRoot "docker-compose.test.yml"
$environmentFile = Join-Path $repositoryRoot ".env.test.local"

$provider = ""
if (Test-Path -LiteralPath $environmentFile) {
  $providerLine = Get-Content -LiteralPath $environmentFile | Where-Object { $_ -like "SBTS_TEST_DATABASE_PROVIDER=*" } | Select-Object -First 1
  if ($providerLine) { $provider = $providerLine.Split("=", 2)[1] }
}

if ($provider -eq "docker-compose") {
  docker compose -f $composeFile down --volumes --remove-orphans
  Remove-Item -LiteralPath $environmentFile -Force
  Write-Host "Disposable PostgreSQL container and test data removed."
} else {
  Write-Host "No repository-managed Docker database is active; existing PostgreSQL was left untouched."
}
