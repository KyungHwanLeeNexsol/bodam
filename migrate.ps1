# =============================================================================
# Neon DB 마이그레이션 스크립트
# 배포 전 실행: .\migrate.ps1
# =============================================================================

$env:DATABASE_URL = "postgresql+asyncpg://neondb_owner:npg_9JzCfg6LOhyr@ep-nameless-frog-a1rxf1ty-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"

Write-Host "=== Neon DB 마이그레이션 ===" -ForegroundColor Cyan
Write-Host "주의: 먼저 Neon 콘솔에서 pgvector 익스텐션을 활성화하세요!" -ForegroundColor Yellow
Write-Host "  SQL: CREATE EXTENSION IF NOT EXISTS vector;" -ForegroundColor Gray
Write-Host ""

Set-Location "$PSScriptRoot\backend"

# uv 또는 Python 직접 경로로 alembic 실행
$uvPath = "$env:USERPROFILE\.cargo\bin\uv.exe"
$uvPath2 = "$env:LOCALAPPDATA\uv\uv.exe"
$alembicPath = "$env:LOCALAPPDATA\Programs\Python\Python312\Scripts\alembic.exe"
$pythonPath = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"

if (Test-Path $uvPath) {
    & $uvPath run alembic upgrade head
} elseif (Test-Path $uvPath2) {
    & $uvPath2 run alembic upgrade head
} elseif (Test-Path $alembicPath) {
    Write-Host "alembic 직접 실행..." -ForegroundColor Gray
    & $alembicPath upgrade head
} elseif (Test-Path $pythonPath) {
    Write-Host "Python으로 alembic 실행..." -ForegroundColor Gray
    & $pythonPath -m alembic upgrade head
} else {
    Write-Host "uv 또는 Python을 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "수동 실행: cd backend && python -m alembic upgrade head" -ForegroundColor Yellow
    exit 1
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n마이그레이션 완료!" -ForegroundColor Green
} else {
    Write-Host "`n마이그레이션 실패. 로그를 확인하세요." -ForegroundColor Red
    exit 1
}
