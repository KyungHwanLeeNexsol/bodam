#!/usr/bin/env bash
# 보담 프로덕션 배포 스크립트
# Usage:
#   bash scripts/deploy_prod.sh              # 기본 배포
#   bash scripts/deploy_prod.sh --no-build   # 빌드 생략 (이미지 재사용)
#   bash scripts/deploy_prod.sh --migrate    # DB 마이그레이션만 실행

set -euo pipefail

# ─────────────────────────────────────────────
# 설정 변수
# ─────────────────────────────────────────────
COMPOSE_FILE="docker-compose.prod.yml"
BACKEND_HEALTH_URL="http://localhost/api/v1/health"
HEALTH_CHECK_RETRY=18     # 최대 재시도 횟수 (18 * 10초 = 180초)
HEALTH_CHECK_INTERVAL=10  # 재시도 간격(초)
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ─────────────────────────────────────────────
# 색상 출력 유틸리티
# ─────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_step()    { echo -e "\n${BLUE}━━━ $* ━━━${NC}"; }

# ─────────────────────────────────────────────
# 인자 파싱
# ─────────────────────────────────────────────
NO_BUILD=false
MIGRATE_ONLY=false

for arg in "$@"; do
    case "$arg" in
        --no-build)    NO_BUILD=true ;;
        --migrate)     MIGRATE_ONLY=true ;;
        *) log_warn "알 수 없는 인자: $arg" ;;
    esac
done

# ─────────────────────────────────────────────
# 0단계: 작업 디렉토리 이동
# ─────────────────────────────────────────────
cd "$APP_DIR"
log_info "작업 디렉토리: $APP_DIR"

# ─────────────────────────────────────────────
# 1단계: 최신 코드 pull
# ─────────────────────────────────────────────
log_step "1단계: 최신 코드 pull"
git pull origin main
log_info "✓ 최신 코드 동기화 완료"

# ─────────────────────────────────────────────
# 2단계: 필수 환경 변수 확인
# ─────────────────────────────────────────────
log_step "2단계: 필수 환경 변수 확인"

if [[ ! -f ".env.prod" ]]; then
    log_error ".env.prod 파일이 없습니다."
    log_error "backend/.env.example을 참조하여 .env.prod를 생성하세요."
    exit 1
fi

# .env.prod에서 환경변수 로드 (검증 목적)
set -a
# shellcheck source=/dev/null
source .env.prod 2>/dev/null || true
set +a

REQUIRED_VARS=("DATABASE_URL" "REDIS_URL" "SECRET_KEY" "GOOGLE_API_KEY")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        MISSING_VARS+=("$var")
    fi
done

if [[ ${#MISSING_VARS[@]} -gt 0 ]]; then
    log_error "다음 필수 환경 변수가 설정되지 않았습니다:"
    for var in "${MISSING_VARS[@]}"; do
        log_error "  - $var"
    done
    exit 1
fi

log_info "✓ 필수 환경 변수 확인 완료"

# 마이그레이션만 실행하는 경우
if [[ "$MIGRATE_ONLY" = true ]]; then
    log_step "DB 마이그레이션 (단독 실행)"
    docker compose -f "$COMPOSE_FILE" run --rm backend alembic upgrade head
    log_info "✓ 마이그레이션 완료"
    exit 0
fi

# ─────────────────────────────────────────────
# 3단계: 도커 이미지 빌드
# ─────────────────────────────────────────────
log_step "3단계: 도커 이미지 빌드"

if [[ "$NO_BUILD" = true ]]; then
    log_warn "빌드 생략 (--no-build 플래그)"
else
    docker compose -f "$COMPOSE_FILE" build backend
    log_info "✓ 이미지 빌드 완료"
fi

# ─────────────────────────────────────────────
# 4단계: DB 마이그레이션
# ─────────────────────────────────────────────
log_step "4단계: DB 마이그레이션 적용"
docker compose -f "$COMPOSE_FILE" run --rm backend alembic upgrade head
log_info "✓ 마이그레이션 완료"

# ─────────────────────────────────────────────
# 5단계: 서비스 재시작 (다운타임 최소화)
# ─────────────────────────────────────────────
log_step "5단계: 서비스 재시작"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
log_info "✓ 서비스 재시작 명령 전송 완료"

# ─────────────────────────────────────────────
# 6단계: 헬스 체크 (최대 180초 대기)
# ─────────────────────────────────────────────
log_step "6단계: 백엔드 헬스 체크 (URL: $BACKEND_HEALTH_URL)"

HEALTH_OK=false
for i in $(seq 1 "$HEALTH_CHECK_RETRY"); do
    if curl -sf "$BACKEND_HEALTH_URL" > /dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
    log_warn "[$i/$HEALTH_CHECK_RETRY] 준비 대기 중... (${HEALTH_CHECK_INTERVAL}초 후 재시도)"
    sleep "$HEALTH_CHECK_INTERVAL"
done

if [[ "$HEALTH_OK" = false ]]; then
    log_error "헬스 체크 실패. 컨테이너 로그를 확인하세요:"
    log_error "  docker compose -f $COMPOSE_FILE logs --tail=50 backend"
    exit 1
fi

log_info "✓ 헬스 체크 통과"

# ─────────────────────────────────────────────
# 완료 안내
# ─────────────────────────────────────────────
echo ""
echo -e "${GREEN}=================================================${NC}"
echo -e "${GREEN}   프로덕션 배포 완료!${NC}"
echo -e "${GREEN}=================================================${NC}"
echo ""
echo "유용한 명령어:"
echo "  로그 확인:         docker compose -f $COMPOSE_FILE logs -f backend"
echo "  서비스 상태:       docker compose -f $COMPOSE_FILE ps"
echo "  파이프라인 실행:   bash scripts/pipeline_cron.sh"
echo "  파이프라인 상태:   docker compose -f $COMPOSE_FILE exec backend python scripts/run_pipeline.py status"
echo ""
