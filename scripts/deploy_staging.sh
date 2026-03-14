#!/usr/bin/env bash
# 보담 스테이징 배포 스크립트
# Usage:
#   bash scripts/deploy_staging.sh
#   bash scripts/deploy_staging.sh --seed    # 시드 데이터 삽입 포함

set -euo pipefail

# ─────────────────────────────────────────────
# 설정 변수
# ─────────────────────────────────────────────
COMPOSE_FILE="docker-compose.staging.yml"
BACKEND_HEALTH_URL="http://localhost:8001/health"
HEALTH_CHECK_RETRY=12     # 최대 재시도 횟수 (12 * 5초 = 60초)
HEALTH_CHECK_INTERVAL=5   # 재시도 간격(초)

# ─────────────────────────────────────────────
# 색상 출력 유틸리티
# ─────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # 색상 초기화

log_info()    { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ─────────────────────────────────────────────
# 인자 파싱
# ─────────────────────────────────────────────
RUN_SEED=false
for arg in "$@"; do
    case "$arg" in
        --seed) RUN_SEED=true ;;
        *) log_warn "알 수 없는 인자: $arg" ;;
    esac
done

# ─────────────────────────────────────────────
# 1단계: 필수 환경 변수 확인
# ─────────────────────────────────────────────
log_info "1단계: 필수 환경 변수 확인 중..."

REQUIRED_VARS=("DATABASE_URL" "REDIS_URL" "OPENAI_API_KEY")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        MISSING_VARS+=("$var")
    fi
done

if [[ ${#MISSING_VARS[@]} -gt 0 ]]; then
    log_error "다음 환경 변수가 설정되지 않았습니다:"
    for var in "${MISSING_VARS[@]}"; do
        log_error "  - $var"
    done
    log_error ".env.staging 파일을 확인하거나 환경 변수를 설정하세요."
    exit 1
fi

log_info "  ✓ 필수 환경 변수 확인 완료"

# ─────────────────────────────────────────────
# 2단계: 도커 이미지 빌드
# ─────────────────────────────────────────────
log_info "2단계: 도커 이미지 빌드 중... (캐시 제외)"
docker compose -f "$COMPOSE_FILE" build --no-cache
log_info "  ✓ 이미지 빌드 완료"

# ─────────────────────────────────────────────
# 3단계: DB 마이그레이션 적용
# ─────────────────────────────────────────────
log_info "3단계: Alembic DB 마이그레이션 적용 중..."
docker compose -f "$COMPOSE_FILE" run --rm backend alembic upgrade head
log_info "  ✓ 마이그레이션 완료"

# ─────────────────────────────────────────────
# 4단계: 서비스 기동
# ─────────────────────────────────────────────
log_info "4단계: 스테이징 서비스 기동 중..."
docker compose -f "$COMPOSE_FILE" up -d
log_info "  ✓ 서비스 기동 명령 전송 완료"

# ─────────────────────────────────────────────
# 5단계: 헬스 체크 (최대 60초 대기)
# ─────────────────────────────────────────────
log_info "5단계: 백엔드 헬스 체크 대기 중... (URL: $BACKEND_HEALTH_URL)"

HEALTH_OK=false
for i in $(seq 1 "$HEALTH_CHECK_RETRY"); do
    if curl -sf "$BACKEND_HEALTH_URL" > /dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
    log_warn "  [$i/$HEALTH_CHECK_RETRY] 아직 준비되지 않음. ${HEALTH_CHECK_INTERVAL}초 후 재시도..."
    sleep "$HEALTH_CHECK_INTERVAL"
done

if [[ "$HEALTH_OK" = false ]]; then
    log_error "헬스 체크 실패: $BACKEND_HEALTH_URL 에 응답이 없습니다."
    log_error "컨테이너 로그를 확인하세요:"
    log_error "  docker compose -f $COMPOSE_FILE logs backend"
    exit 1
fi

log_info "  ✓ 헬스 체크 통과"

# ─────────────────────────────────────────────
# 6단계: 시드 데이터 삽입 (--seed 플래그 시)
# ─────────────────────────────────────────────
if [[ "$RUN_SEED" = true ]]; then
    log_info "6단계: 스테이징 시드 데이터 삽입 중..."
    python scripts/seed_staging.py
    log_info "  ✓ 시드 데이터 삽입 완료"
else
    log_info "6단계: 시드 생략 (--seed 플래그 없음)"
fi

# ─────────────────────────────────────────────
# 7단계: 배포 완료 안내
# ─────────────────────────────────────────────
echo ""
echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}   스테이징 배포 완료!${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo "서비스 URL:"
echo "  백엔드 API:    http://localhost:8001"
echo "  헬스 체크:     http://localhost:8001/health"
echo "  API 문서:      http://localhost:8001/docs"
echo ""
echo "유용한 명령어:"
echo "  로그 확인:     docker compose -f $COMPOSE_FILE logs -f backend"
echo "  서비스 상태:   docker compose -f $COMPOSE_FILE ps"
echo "  서비스 중지:   docker compose -f $COMPOSE_FILE down"
echo ""
