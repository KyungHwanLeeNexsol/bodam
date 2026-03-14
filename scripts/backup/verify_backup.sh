#!/bin/bash
# PostgreSQL 백업 검증 스크립트 (SPEC-INFRA-002 M1)
# 최신 백업을 임시 DB에 복원하고 무결성 검사 수행
#
# 환경변수:
#   BACKUP_DIR    백업 저장 경로 (기본값: ./backups/postgres)
#   POSTGRES_USER PostgreSQL 사용자명 (기본값: bodam)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
POSTGRES_USER="${POSTGRES_USER:-bodam}"
LOG_FILE="${BACKUP_DIR}/verify.log"

# ─────────────────────────────────────────────
# 로그 함수
# ─────────────────────────────────────────────
log_info() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [INFO] $*" | tee -a "${LOG_FILE}"
}

log_error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR] $*" | tee -a "${LOG_FILE}" >&2
}

# ─────────────────────────────────────────────
# 정리 함수 (임시 DB 삭제)
# ─────────────────────────────────────────────
cleanup() {
    if [ -n "${VERIFY_DB:-}" ]; then
        log_info "임시 데이터베이스 삭제: ${VERIFY_DB}"
        docker compose exec -T postgres dropdb -U "${POSTGRES_USER}" "${VERIFY_DB}" 2>/dev/null || true
    fi
}

trap cleanup EXIT

# ─────────────────────────────────────────────
# 백업 검증 수행
# ─────────────────────────────────────────────
main() {
    log_info "백업 검증 시작"

    # 최신 백업 파일 탐색
    LATEST_BACKUP=$(ls -t "${BACKUP_DIR}"/bodam_*.sql.gz 2>/dev/null | head -1)
    if [ -z "${LATEST_BACKUP}" ]; then
        log_error "백업 파일을 찾을 수 없습니다: ${BACKUP_DIR}"
        exit 1
    fi
    log_info "검증 대상: ${LATEST_BACKUP}"

    # 임시 데이터베이스 이름 생성
    VERIFY_DB="bodam_verify_$(date +%s)"

    # 임시 데이터베이스 생성
    log_info "임시 데이터베이스 생성: ${VERIFY_DB}"
    docker compose exec -T postgres createdb -U "${POSTGRES_USER}" "${VERIFY_DB}"

    # 백업 복원
    log_info "백업 복원 중..."
    if gunzip -c "${LATEST_BACKUP}" | docker compose exec -T postgres psql -U "${POSTGRES_USER}" "${VERIFY_DB}" > /dev/null 2>&1; then
        log_info "백업 복원 성공"
    else
        log_error "백업 복원 실패"
        exit 1
    fi

    # 기본 무결성 검사 - public 스키마 테이블 수 확인
    TABLE_COUNT=$(docker compose exec -T postgres psql -U "${POSTGRES_USER}" -d "${VERIFY_DB}" \
        -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" \
        | tr -d ' ')

    if [ "${TABLE_COUNT}" -gt 0 ]; then
        log_info "무결성 검사 통과: public 스키마에 ${TABLE_COUNT}개 테이블 발견"
    else
        log_error "무결성 검사 실패: 테이블이 없습니다"
        exit 1
    fi

    log_info "백업 검증 완료"
}

main "$@"
