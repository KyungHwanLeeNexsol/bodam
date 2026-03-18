# =============================================================================
# Bodam Fly.io 배포 스크립트
# PowerShell 관리자 모드에서 실행: .\deploy.ps1
# =============================================================================

Set-StrictMode -Off
$ErrorActionPreference = "Stop"

Write-Host "=== Bodam Fly.io 배포 시작 ===" -ForegroundColor Cyan

# Step 1: Fly CLI 확인
Write-Host "`n[1/6] Fly CLI 확인..." -ForegroundColor Yellow
if (-not (Get-Command fly -ErrorAction SilentlyContinue)) {
    Write-Host "Fly CLI 설치 중..." -ForegroundColor Yellow
    iwr https://fly.io/install.ps1 -useb | iex
}
fly version

# Step 2: Fly.io 로그인 확인
Write-Host "`n[2/6] Fly.io 로그인 확인..." -ForegroundColor Yellow
fly auth whoami
if ($LASTEXITCODE -ne 0) {
    Write-Host "로그인이 필요합니다..."
    fly auth login
}

# Step 3: 앱 생성 (이미 있으면 건너뜀)
Write-Host "`n[3/6] 앱 생성..." -ForegroundColor Yellow
fly apps list | Select-String "bodam"
if ($LASTEXITCODE -ne 0) {
    fly apps create bodam
} else {
    Write-Host "앱 'bodam' 이미 존재합니다. 건너뜁니다."
}

# Step 4: 시크릿 설정
Write-Host "`n[4/6] 시크릿 설정 중..." -ForegroundColor Yellow
Get-Content "$PSScriptRoot\backend\.env.fly" | fly secrets import --app bodam
Write-Host "시크릿 설정 완료!" -ForegroundColor Green

# Step 5: 배포
Write-Host "`n[5/6] 배포 중... (첫 배포는 5-10분 소요)" -ForegroundColor Yellow
fly deploy --app bodam

# Step 6: 헬스체크
Write-Host "`n[6/6] 헬스체크..." -ForegroundColor Yellow
Start-Sleep -Seconds 10
fly status --app bodam

Write-Host "`n=== 배포 완료 ===" -ForegroundColor Green
Write-Host "앱 URL: https://bodam.fly.dev" -ForegroundColor Cyan
Write-Host "헬스체크: https://bodam.fly.dev/health" -ForegroundColor Cyan
Write-Host "로그 확인: fly logs --app bodam" -ForegroundColor Gray
