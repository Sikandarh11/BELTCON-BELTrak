$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repositoryRoot
try {
  & (Join-Path $PSScriptRoot "test-db-start.ps1")
  npm.cmd run test:postgres
} finally {
  & (Join-Path $PSScriptRoot "test-db-stop.ps1")
  Pop-Location
}
