$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repositoryRoot
try {
  node scripts/test-db-reset.mjs
} finally {
  Pop-Location
}
