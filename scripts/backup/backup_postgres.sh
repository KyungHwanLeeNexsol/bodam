#!/bin/bash
# PostgreSQL 자동 백업 스크립트 (SPEC-INFRA-002 M1)
# 사용법: ./scripts/backup/backup_postgres.sh [--upload-s3]
#
# 환경변수:
#   BACKUP_DIR        백업 저장 경로 (기본값: ./backups/postgres)
#   RETENTION_DAYS    백업 보관 일수 (기본값: 30)
#   POSTGRES_USER     PostgreSQL 사용자명 (기본값: bodam)
#   POSTGRES_DB       데이터베이스명 (기본값: bodam)
#   BACKUP_S3_BUCKET  S3 버킷명 (설정 시 --upload-s3 옵션으로 업로드)

set -euo pipefail

# ─────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
POSTGRES_USER="${POSTGRES_USER:-bodam}"
POSTGRES_DB="${POSTGRES_DB:-bodam}"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M)
BACKUP_FILE="bodam_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"
LOG_FILE="${BACKUP_DIR}/backup.log"
FAILURE_COUNT_FILE="${BACKUP_DIR}/.failure_count"

# ─────────────────────────────────────────────
# 로그 함수
# ─────────────────────────────────────────────
log_info() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [INFO] $*" | tee -a "${LOG_FILE}"
}

log_error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR] $*" | tee -a "${LOG_FILE}" >&2
}

log_warning() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [WARNING] $*" | tee -a "${LOG_FILE}" >&2
}

# ─────────────────────────────────────────────
# 연속 실패 횟수 관리
# ─────────────────────────────────────────────
get_failure_count() {
    if [ -f "${FAILURE_COUNT_FILE}" ]; then
        cat "${FAILURE_COUNT_FILE}"
    else
        echo 0
    fi
}

increment_failure_count() {
    local count
    count=$(get_failure_count)
    count=$((count + 1))
    echo "${count}" > "${FAILURE_COUNT_FILE}"
    echo "${count}"
}

reset_failure_count() {
    echo 0 > "${FAILURE_COUNT_FILE}"
}

# ─────────────────────────────────────────────
# 백업 수행
# ─────────────────────────────────────────────
main() {
    log_info "백업 시작: ${BACKUP_FILE}"

    # 백업 디렉토리 생성
    mkdir -p "${BACKUP_DIR}"

    # pg_dump 실행 (gzip 압축)
    if docker compose exec -T postgres pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" \
        | gzip > "${BACKUP_PATH}"; then
        log_info "백업 성공: ${BACKUP_PATH}"
        reset_failure_count
    else
        local failure_count
        failure_count=$(increment_failure_count)
        log_error "백업 실패: pg_dump 오류 발생 (연속 실패 횟수: ${failure_count})"

        # 연속 3회 실패 시 경고
        if [ "${failure_count}" -ge 3 ]; then
            log_warning "연속 ${failure_count}회 백업 실패 - 즉시 확인이 필요합니다"
        fi

        # 빈 백업 파일 삭제
        rm -f "${BACKUP_PATH}"
        exit 1
    fi

    # ─────────────────────────────────────────
    # 30일 롤링 보관 - 오래된 백업 삭제
    # ─────────────────────────────────────────
    log_info "${RETENTION_DAYS}일 이전 백업 파일 삭제 중..."
    find "${BACKUP_DIR}" -name "bodam_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
    log_info "오래된 백업 정리 완료"

    # ─────────────────────────────────────────
    # S3 업로드 (선택적)
    # ─────────────────────────────────────────
    if [ -n "${BACKUP_S3_BUCKET:-}" ] && [ "${1:-}" = "--upload-s3" ]; then
        log_info "S3 업로드 시작: s3://${BACKUP_S3_BUCKET}/backups/${BACKUP_FILE}"
        if aws s3 cp "${BACKUP_PATH}" "s3://${BACKUP_S3_BUCKET}/backups/${BACKUP_FILE}"; then
            log_info "S3 업로드 완료"
        else
            log_error "S3 업로드 실패 (로컬 백업은 유지됨)"
            exit 1
        fi
    fi

    log_info "백업 프로세스 완료"
}

main "$@"
