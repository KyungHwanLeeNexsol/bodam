#!/bin/bash
# 생보 PDF 인제스트 - 회사별 순차 처리
# 로그: backend/data/ingest_log.txt

LOG="C:/Users/Administrator/Documents/workspace/bodam/backend/data/ingest_log.txt"
UV="/c/Python313/Scripts/uv.exe"
BACKEND="C:/Users/Administrator/Documents/workspace/bodam/backend"
export UV_PROJECT_ENVIRONMENT="C:/tmp/bodam-venv"

echo "=== 생보 인제스트 시작: $(date) ===" | tee -a "$LOG"

COMPANIES=(abl aia bnp_life chubb_life db dongyang_life fubon_hyundai_life hana_life hanwha_life heungkuk_life im_life kb_life kdb kyobo_life kyobo_lifeplanet lina_life metlife mirae_life nh samsung_life shinhan_life unknown_life)

for company in "${COMPANIES[@]}"; do
  count=$(ls "$BACKEND/data/$company/"*.pdf 2>/dev/null | wc -l)
  if [ "$count" -gt 0 ]; then
    echo "[$(date '+%H:%M:%S')] === $company (${count}개) 시작 ===" | tee -a "$LOG"
    cd "$BACKEND" && "$UV" run python scripts/ingest_local_pdfs.py --company "$company" 2>&1 \
      | grep -E "처리 완료|처리 실패|스킵|보험사 생성|===|총|성공|실패" \
      | tee -a "$LOG"
    echo "[$(date '+%H:%M:%S')] === $company 완료 ===" | tee -a "$LOG"
  fi
done

echo "=== 전체 인제스트 완료: $(date) ===" | tee -a "$LOG"
