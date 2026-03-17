#!/bin/bash
# =============================================================================
# 보담 마이그레이션 스크립트: OCI → Fly.io + Neon + Upstash
# 사용법: bash scripts/migrate-to-flyio.sh
# =============================================================================

set -e

echo "============================================="
echo "  보담 마이그레이션: OCI → Fly.io + Neon"
echo "============================================="
echo ""

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 체크 함수
check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}[OK]${NC} $1 설치됨"
        return 0
    else
        echo -e "${RED}[MISSING]${NC} $1 설치 필요"
        return 1
    fi
}

# =============================================================================
# Step 0: 사전 요구사항 확인
# =============================================================================
echo ">>> Step 0: 사전 요구사항 확인"
echo "---"

check_command flyctl || { echo "flyctl 설치: https://fly.io/docs/flyctl/install/"; exit 1; }
check_command psql || echo -e "${YELLOW}[WARN]${NC} psql 없음 - 데이터 마이그레이션 시 필요"
echo ""

# Fly.io 로그인 확인
if flyctl auth whoami &> /dev/null; then
    echo -e "${GREEN}[OK]${NC} Fly.io 로그인됨: $(flyctl auth whoami)"
else
    echo -e "${YELLOW}[ACTION]${NC} Fly.io 로그인 필요"
    flyctl auth login
fi
echo ""

# =============================================================================
# Step 1: Fly.io 앱 확인/생성
# =============================================================================
echo ">>> Step 1: Fly.io 앱 확인"
echo "---"

APP_NAME="bodam"
if flyctl apps list | grep -q "$APP_NAME"; then
    echo -e "${GREEN}[OK]${NC} 앱 '$APP_NAME' 이미 존재"
else
    echo -e "${YELLOW}[ACTION]${NC} 앱 '$APP_NAME' 생성 중..."
    flyctl apps create "$APP_NAME" --org personal
fi
echo ""

# =============================================================================
# Step 2: 환경변수(Secrets) 설정
# =============================================================================
echo ">>> Step 2: Fly.io Secrets 설정"
echo "---"
echo -e "${YELLOW}[중요]${NC} backend/.env.fly.example를 참고하여 실제 값으로 설정하세요."
echo ""
echo "방법 1: 하나씩 설정"
echo "  flyctl secrets set DATABASE_URL=\"postgresql+asyncpg://...\" --app $APP_NAME"
echo ""
echo "방법 2: 파일로 한번에 설정"
echo "  1) cp backend/.env.fly.example backend/.env.fly"
echo "  2) backend/.env.fly 파일에 실제 값 입력"
echo "  3) flyctl secrets import < backend/.env.fly --app $APP_NAME"
echo ""

read -p "Secrets 설정을 완료했나요? (y/n): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Secrets 설정 후 스크립트를 다시 실행하세요."
    echo ""
    echo "필수 Secrets 목록:"
    echo "  DATABASE_URL, REDIS_URL, SECRET_KEY"
    echo "  OPENAI_API_KEY, GEMINI_API_KEY"
    echo "  KAKAO_CLIENT_ID, KAKAO_CLIENT_SECRET, KAKAO_REDIRECT_URI"
    echo "  NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, NAVER_REDIRECT_URI"
    echo "  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI"
    echo "  SOCIAL_TOKEN_ENCRYPTION_KEY, ALLOWED_ORIGINS"
    exit 0
fi
echo ""

# =============================================================================
# Step 3: 데이터 마이그레이션 (OCI PostgreSQL → Neon)
# =============================================================================
echo ">>> Step 3: 데이터 마이그레이션"
echo "---"

read -p "OCI에서 Neon으로 데이터를 마이그레이션 하시겠습니까? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "OCI PostgreSQL URL (postgresql://user:pass@host:5432/dbname): " OCI_DB_URL
    read -p "Neon PostgreSQL URL (postgresql://user:pass@ep-xxx.neon.tech/bodam): " NEON_DB_URL

    echo "OCI에서 덤프 중..."
    pg_dump "$OCI_DB_URL" --no-owner --no-acl --clean --if-exists > /tmp/bodam_dump.sql
    echo -e "${GREEN}[OK]${NC} 덤프 완료: /tmp/bodam_dump.sql ($(du -h /tmp/bodam_dump.sql | cut -f1))"

    echo "Neon으로 복원 중..."
    psql "$NEON_DB_URL" < /tmp/bodam_dump.sql
    echo -e "${GREEN}[OK]${NC} 데이터 마이그레이션 완료"
else
    echo "데이터 마이그레이션 건너뜀 (나중에 수동으로 진행)"
fi
echo ""

# =============================================================================
# Step 4: Fly.io 배포
# =============================================================================
echo ">>> Step 4: Fly.io 백엔드 배포"
echo "---"

read -p "Fly.io에 배포하시겠습니까? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "배포 시작..."
    flyctl deploy --app "$APP_NAME"
    echo ""

    # 헬스체크
    echo "헬스체크 대기 (20초)..."
    sleep 20
    HEALTH_URL="https://${APP_NAME}.fly.dev/api/v1/health"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}[OK]${NC} 백엔드 배포 성공! $HEALTH_URL → 200"
    else
        echo -e "${RED}[FAIL]${NC} 헬스체크 실패 (HTTP $HTTP_CODE)"
        echo "로그 확인: flyctl logs --app $APP_NAME"
    fi
else
    echo "배포 건너뜀"
fi
echo ""

# =============================================================================
# Step 5: 결과 및 남은 작업
# =============================================================================
echo "============================================="
echo "  마이그레이션 완료 체크리스트"
echo "============================================="
echo ""
echo -e "${GREEN}[자동 완료]${NC}"
echo "  - Fly.io 앱 생성/확인"
echo "  - 백엔드 배포"
echo ""
echo -e "${YELLOW}[수동 필요]${NC} Vercel 프론트엔드 환경변수 변경:"
echo "  Vercel Dashboard → Settings → Environment Variables"
echo "  NEXT_PUBLIC_API_URL = https://${APP_NAME}.fly.dev"
echo "  변경 후 Redeploy 필요!"
echo ""
echo -e "${YELLOW}[수동 필요]${NC} OAuth 리다이렉트 URI 변경:"
echo ""
echo "  카카오 (developers.kakao.com):"
echo "    → https://${APP_NAME}.fly.dev/api/v1/auth/oauth/kakao/callback"
echo ""
echo "  네이버 (developers.naver.com):"
echo "    → https://${APP_NAME}.fly.dev/api/v1/auth/oauth/naver/callback"
echo ""
echo "  구글 (console.cloud.google.com):"
echo "    → https://${APP_NAME}.fly.dev/api/v1/auth/oauth/google/callback"
echo "    + Authorized JavaScript origins: https://bodam-one.vercel.app"
echo ""
echo -e "${YELLOW}[수동 필요]${NC} 검증:"
echo "  1. https://${APP_NAME}.fly.dev/api/v1/health"
echo "  2. Vercel 프론트 → 로그인 테스트"
echo "  3. 카카오/네이버/구글 소셜 로그인 테스트"
echo "  4. 채팅 기능 테스트"
echo ""
echo "============================================="
echo "  모든 작업 완료 후 OCI VM을 중지/삭제하세요"
echo "============================================="
