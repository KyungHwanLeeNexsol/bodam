#!/usr/bin/env bash
# 크롤러 완료 대기 후 인제스트 실행 (2차)
# 크롤러 PIDs: 8908(메리츠화재), 9651(현대해상), 8956(KB손보)
# 기존 인제스트 PID: 6592

PYTHON="/c/Python313/python.exe"
BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$BACKEND_DIR/scripts/ingest_auto2.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"
}

wait_pid() {
    local pid=$1
    local name=$2
    if kill -0 "$pid" 2>/dev/null; then
        log "대기 중: $name (PID $pid)"
        while kill -0 "$pid" 2>/dev/null; do
            sleep 30
        done
        log "완료: $name (PID $pid)"
    else
        log "이미 종료: $name (PID $pid)"
    fi
}

log "=================================================="
log "크롤러 및 기존 인제스트 완료 대기 시작"
log "=================================================="

# 크롤러 완료 대기
wait_pid 8908 "메리츠화재"
wait_pid 9651 "현대해상"
wait_pid 8956 "KB손보"

log "모든 크롤러 완료!"
log "=================================================="

# 기존 인제스트(6592) 완료 대기
wait_pid 6592 "기존 인제스트"

log "기존 인제스트 완료!"
log "=================================================="
log "2차 인제스트 시작..."

cd "$BACKEND_DIR" || exit 1
PYTHONIOENCODING=utf-8 PYTHONPATH="$BACKEND_DIR" \
    "$PYTHON" -m scripts.ingest_local_pdfs >> "$LOG" 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    log "2차 인제스트 완료!"
else
    log "2차 인제스트 실패 (exit code: $EXIT_CODE)"
fi

log "=================================================="
