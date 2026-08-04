$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repositoryRoot "docker-compose.test.yml"
$environmentFile = Join-Path $repositoryRoot ".env.test.local"
$testUrl = "postgresql://sbts_test:sbts_test@127.0.0.1:55432/sbts_test"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is not installed. Install Docker, or configure .env.test.local for an existing disposable PostgreSQL database."
}

docker info *> $null
docker compose -f $composeFile up -d --wait

@"
SBTS_TEST_DATABASE_URL=$testUrl
SBTS_TEST_DATABASE_PROVIDER=docker-compose
SBTS_REQUIRE_POSTGRES_TESTS=true
"@ | Set-Content -LiteralPath $environmentFile -Encoding utf8

Write-Host "Disposable PostgreSQL ready: sbts_test@127.0.0.1:55432/sbts_test"
