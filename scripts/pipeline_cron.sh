#!/usr/bin/env bash
# 보담 약관 수집 파이프라인 (cron 실행용)
#
# cron 등록 예시:
#   crontab -e 에서 아래 추가:
#   0 2 * * * /path/to/bodam/scripts/pipeline_cron.sh >> /var/log/bodam/pipeline.log 2>&1
#
# Usage:
#   bash scripts/pipeline_cron.sh           # 수집 + 임베딩 전체 실행
#   bash scripts/pipeline_cron.sh --crawl   # 수집만 실행
#   bash scripts/pipeline_cron.sh --embed   # 임베딩만 실행

set -euo pipefail

# ─────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="docker-compose.prod.yml"
BACKEND_SERVICE="backend"
LOG_DIR="/var/log/bodam"
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"

# ─────────────────────────────────────────────
# 색상 출력 유틸리티
# ─────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[$TIMESTAMP][INFO]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[$TIMESTAMP][WARN]${NC} $*"; }
log_error() { echo -e "${RED}[$TIMESTAMP][ERROR]${NC} $*" >&2; }

# ─────────────────────────────────────────────
# 인자 파싱
# ─────────────────────────────────────────────
RUN_CRAWL=true
RUN_EMBED=true

for arg in "$@"; do
    case "$arg" in
        --crawl) RUN_CRAWL=true;  RUN_EMBED=false ;;
        --embed) RUN_CRAWL=false; RUN_EMBED=true  ;;
        *) log_warn "알 수 없는 인자: $arg" ;;
    esac
done

# ─────────────────────────────────────────────
# 초기화
# ─────────────────────────────────────────────
cd "$APP_DIR"

# 로그 디렉토리 생성 (없을 경우)
mkdir -p "$LOG_DIR"

log_info "================================================="
log_info "보담 파이프라인 시작"
log_info "================================================="

# ─────────────────────────────────────────────
# 백엔드 컨테이너 실행 여부 확인
# ─────────────────────────────────────────────
if ! docker compose -f "$COMPOSE_FILE" ps "$BACKEND_SERVICE" | grep -q "running\|Up"; then
    log_error "백엔드 컨테이너가 실행 중이 아닙니다."
    log_error "먼저 서비스를 시작하세요: docker compose -f $COMPOSE_FILE up -d"
    exit 1
fi

log_info "✓ 백엔드 컨테이너 실행 확인"

# ─────────────────────────────────────────────
# 수집 단계
# ─────────────────────────────────────────────
if [[ "$RUN_CRAWL" = true ]]; then
    log_info "--- 1단계: 약관 수집 시작 ---"

    CRAWL_START=$(date +%s)

    if docker compose -f "$COMPOSE_FILE" exec -T "$BACKEND_SERVICE" \
        python scripts/run_pipeline.py crawl --all; then
        CRAWL_END=$(date +%s)
        CRAWL_ELAPSED=$((CRAWL_END - CRAWL_START))
        log_info "✓ 약관 수집 완료 (소요: ${CRAWL_ELAPSED}초)"
    else
        log_error "약관 수집 실패"
        exit 1
    fi
fi

# ─────────────────────────────────────────────
# 임베딩 단계
# ─────────────────────────────────────────────
if [[ "$RUN_EMBED" = true ]]; then
    log_info "--- 2단계: 임베딩 생성 시작 ---"

    EMBED_START=$(date +%s)

    if docker compose -f "$COMPOSE_FILE" exec -T "$BACKEND_SERVICE" \
        python scripts/run_pipeline.py embed --all; then
        EMBED_END=$(date +%s)
        EMBED_ELAPSED=$((EMBED_END - EMBED_START))
        log_info "✓ 임베딩 생성 완료 (소요: ${EMBED_ELAPSED}초)"
    else
        log_error "임베딩 생성 실패"
        exit 1
    fi
fi

# ─────────────────────────────────────────────
# 현황 출력
# ─────────────────────────────────────────────
log_info "--- 현재 데이터 현황 ---"
docker compose -f "$COMPOSE_FILE" exec -T "$BACKEND_SERVICE" \
    python scripts/run_pipeline.py status || true

log_info "================================================="
log_info "파이프라인 완료"
log_info "================================================="
