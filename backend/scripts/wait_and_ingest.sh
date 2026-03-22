#!/usr/bin/env bash
PYTHON="/c/Python313/python.exe"
BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$BACKEND_DIR/scripts/ingest_auto.log"

# 현재 크롤러 PIDs (실행 시 탐지)
CRAWLER_PIDS=""
for pid in $(ps aux | awk '{print $1}' | grep -E '^[0-9]+$'); do
    [ -f "/proc/$pid/cmdline" ] || continue
    cmd=$(cat "/proc/$pid/cmdline" 2>/dev/null | tr '\0' ' ')
    if echo "$cmd" | grep -q "crawl_"; then
        CRAWLER_PIDS="$CRAWLER_PIDS $pid"
    fi
done

if [ -z "$CRAWLER_PIDS" ]; then
    echo "[$(date)] 크롤러 없음, 바로 인제스트 시작..." | tee -a "$LOG"
else
    echo "[$(date)] 크롤러 대기 (PIDs:$CRAWLER_PIDS)..." | tee -a "$LOG"
    for pid in $CRAWLER_PIDS; do
        while kill -0 "$pid" 2>/dev/null; do
            echo "[$(date)] PID $pid 실행 중... 30초 대기" | tee -a "$LOG"
            sleep 30
        done
        echo "[$(date)] PID $pid 완료" | tee -a "$LOG"
    done
fi

echo "[$(date)] Neon 인제스트 시작..." | tee -a "$LOG"
cd "$BACKEND_DIR"
PYTHONIOENCODING=utf-8 PYTHONPATH="$BACKEND_DIR" "$PYTHON" -m scripts.ingest_local_pdfs 2>&1 | tee -a "$LOG"
echo "[$(date)] 종료 (exit: $?)" | tee -a "$LOG"
