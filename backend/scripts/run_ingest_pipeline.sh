#!/usr/bin/env bash
# 인제스트 완전수집 보험사 순차 실행 + 문서 자동 업데이트
# 사용법:
#   bash scripts/run_ingest_pipeline.sh
#   nohup bash scripts/run_ingest_pipeline.sh > data/ingest_pipeline.log 2>&1 &

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
PYTHON="/c/Users/Nexsol/AppData/Local/Programs/Python/Python312/python.exe"
LOG_DIR="$BACKEND_DIR/data"
TIMESTAMP="$(date '+%Y%m%d_%H%M%S')"
LOG_FILE="$LOG_DIR/ingest_pipeline_${TIMESTAMP}.log"

# 인제스트 대상 (sale_status 완전수집 완료 보험사 — 큰 순서대로)
COMPANIES=(
  "lotte_insurance"
  "axa_general"
  "nh_fire"
  "mg_insurance"
  "heungkuk_fire"
)

cd "$BACKEND_DIR"

echo "=====================================================" | tee -a "$LOG_FILE"
echo "인제스트 파이프라인 시작: $(date)" | tee -a "$LOG_FILE"
echo "대상: ${COMPANIES[*]}" | tee -a "$LOG_FILE"
echo "로그: $LOG_FILE" | tee -a "$LOG_FILE"
echo "=====================================================" | tee -a "$LOG_FILE"

TOTAL=${#COMPANIES[@]}
SUCCESS=0
FAILED=0

for i in "${!COMPANIES[@]}"; do
  COMPANY="${COMPANIES[$i]}"
  STEP=$((i + 1))

  echo "" | tee -a "$LOG_FILE"
  echo "[$STEP/$TOTAL] ▶ $COMPANY 인제스트 시작: $(date)" | tee -a "$LOG_FILE"
  echo "-----------------------------------------------------" | tee -a "$LOG_FILE"

  # 인제스트 실행
  if "$PYTHON" scripts/ingest_local_pdfs.py --company "$COMPANY" 2>&1 | tee -a "$LOG_FILE"; then
    echo "" | tee -a "$LOG_FILE"
    echo "[$STEP/$TOTAL] ✅ $COMPANY 인제스트 완료: $(date)" | tee -a "$LOG_FILE"
    SUCCESS=$((SUCCESS + 1))

    # 현황 문서 자동 업데이트
    echo "[$STEP/$TOTAL] 📄 현황 문서 업데이트 중..." | tee -a "$LOG_FILE"
    if "$PYTHON" scripts/update_pipeline_status.py --company "$COMPANY" 2>&1 | tee -a "$LOG_FILE"; then
      echo "[$STEP/$TOTAL] ✅ 현황 문서 업데이트 완료" | tee -a "$LOG_FILE"

      # git commit (현황 문서)
      cd "$BACKEND_DIR/.."
      if git diff --quiet docs/insurance-pipeline-status.md 2>/dev/null; then
        echo "[$STEP/$TOTAL] ℹ 문서 변경 없음 (스킵)" | tee -a "$LOG_FILE"
      else
        git add docs/insurance-pipeline-status.md
        git commit -m "docs(pipeline): $COMPANY 인제스트 완료 현황 업데이트

🗿 MoAI <email@mo.ai.kr>" >> "$LOG_FILE" 2>&1 && \
          git push origin main >> "$LOG_FILE" 2>&1 && \
          echo "[$STEP/$TOTAL] ✅ git push 완료" | tee -a "$LOG_FILE" || \
          echo "[$STEP/$TOTAL] ⚠ git push 실패 (로컬 업데이트는 완료)" | tee -a "$LOG_FILE"
      fi
      cd "$BACKEND_DIR"
    else
      echo "[$STEP/$TOTAL] ⚠ 현황 문서 업데이트 실패 (인제스트는 완료)" | tee -a "$LOG_FILE"
    fi
  else
    echo "" | tee -a "$LOG_FILE"
    echo "[$STEP/$TOTAL] ❌ $COMPANY 인제스트 실패: $(date)" | tee -a "$LOG_FILE"
    FAILED=$((FAILED + 1))
    # 실패해도 다음 보험사 계속 진행
  fi

  echo "-----------------------------------------------------" | tee -a "$LOG_FILE"
done

echo "" | tee -a "$LOG_FILE"
echo "=====================================================" | tee -a "$LOG_FILE"
echo "파이프라인 완료: $(date)" | tee -a "$LOG_FILE"
echo "성공: $SUCCESS / 실패: $FAILED / 전체: $TOTAL" | tee -a "$LOG_FILE"
echo "로그 파일: $LOG_FILE" | tee -a "$LOG_FILE"
echo "=====================================================" | tee -a "$LOG_FILE"
