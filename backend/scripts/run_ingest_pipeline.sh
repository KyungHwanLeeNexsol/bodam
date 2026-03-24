#!/usr/bin/env bash
# 보험사별 순차 파이프라인: 크롤링 => 인제스트 => 임베딩 DB저장 => 현황문서 업데이트
#
# 원칙: 여러 보험사를 한꺼번에 수집하지 않고, 보험사 1개씩 완전 처리 후 다음으로
#
# 사용법:
#   bash scripts/run_ingest_pipeline.sh --company lotte_insurance
#   bash scripts/run_ingest_pipeline.sh --company axa_general
#   nohup bash scripts/run_ingest_pipeline.sh --company lotte_insurance > data/pipeline_lotte.log 2>&1 &

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
PYTHON="/c/Users/Nexsol/AppData/Local/Programs/Python/Python312/python.exe"
LOG_DIR="$BACKEND_DIR/data"
TIMESTAMP="$(date '+%Y%m%d_%H%M%S')"

# 인수 파싱
COMPANY=""
SKIP_CRAWL=false
SKIP_INGEST=false
SKIP_EMBED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --company)
      COMPANY="$2"
      shift 2
      ;;
    --skip-crawl)
      SKIP_CRAWL=true
      shift
      ;;
    --skip-ingest)
      SKIP_INGEST=true
      shift
      ;;
    --skip-embed)
      SKIP_EMBED=true
      shift
      ;;
    *)
      echo "알 수 없는 옵션: $1"
      echo "사용법: $0 --company <company_id> [--skip-crawl] [--skip-ingest] [--skip-embed]"
      exit 1
      ;;
  esac
done

if [[ -z "$COMPANY" ]]; then
  echo "오류: --company 옵션이 필요합니다."
  echo "예시: $0 --company lotte_insurance"
  echo ""
  echo "지원 보험사 코드:"
  echo "  손해보험: lotte_insurance, axa_general, nh_fire, mg_insurance, heungkuk_fire"
  echo "           samsung_fire, hyundai_marine, db_insurance, meritz_fire, kb_insurance"
  exit 1
fi

LOG_FILE="$LOG_DIR/pipeline_${COMPANY}_${TIMESTAMP}.log"

cd "$BACKEND_DIR"

echo "=====================================================" | tee -a "$LOG_FILE"
echo "파이프라인 시작: $COMPANY" | tee -a "$LOG_FILE"
echo "시작 시각: $(date)" | tee -a "$LOG_FILE"
echo "로그: $LOG_FILE" | tee -a "$LOG_FILE"
echo "=====================================================" | tee -a "$LOG_FILE"

# ── Step 1: 크롤링 ─────────────────────────────────────────────
if [[ "$SKIP_CRAWL" == "false" ]]; then
  echo "" | tee -a "$LOG_FILE"
  echo "[1/4] ▶ 크롤링 시작: $(date)" | tee -a "$LOG_FILE"
  echo "-----------------------------------------------------" | tee -a "$LOG_FILE"

  if "$PYTHON" scripts/crawl_nonlife_playwright.py --company "$COMPANY" 2>&1 | tee -a "$LOG_FILE"; then
    echo "[1/4] ✅ 크롤링 완료: $(date)" | tee -a "$LOG_FILE"
  else
    echo "[1/4] ❌ 크롤링 실패: $(date)" | tee -a "$LOG_FILE"
    echo "파이프라인 중단." | tee -a "$LOG_FILE"
    exit 1
  fi
else
  echo "[1/4] ⏭ 크롤링 스킵 (--skip-crawl)" | tee -a "$LOG_FILE"
fi

# ── Step 2: 인제스트 ───────────────────────────────────────────
if [[ "$SKIP_INGEST" == "false" ]]; then
  echo "" | tee -a "$LOG_FILE"
  echo "[2/4] ▶ 인제스트 시작: $(date)" | tee -a "$LOG_FILE"
  echo "-----------------------------------------------------" | tee -a "$LOG_FILE"

  if "$PYTHON" scripts/ingest_local_pdfs.py --company "$COMPANY" 2>&1 | tee -a "$LOG_FILE"; then
    echo "[2/4] ✅ 인제스트 완료: $(date)" | tee -a "$LOG_FILE"
  else
    echo "[2/4] ❌ 인제스트 실패: $(date)" | tee -a "$LOG_FILE"
    echo "파이프라인 중단." | tee -a "$LOG_FILE"
    exit 1
  fi
else
  echo "[2/4] ⏭ 인제스트 스킵 (--skip-ingest)" | tee -a "$LOG_FILE"
fi

# ── Step 3: 임베딩 DB저장 ──────────────────────────────────────
if [[ "$SKIP_EMBED" == "false" ]]; then
  echo "" | tee -a "$LOG_FILE"
  echo "[3/4] ▶ 임베딩/DB저장 시작: $(date)" | tee -a "$LOG_FILE"
  echo "-----------------------------------------------------" | tee -a "$LOG_FILE"

  if "$PYTHON" scripts/ingest_local_pdfs.py --company "$COMPANY" --embed 2>&1 | tee -a "$LOG_FILE"; then
    echo "[3/4] ✅ 임베딩/DB저장 완료: $(date)" | tee -a "$LOG_FILE"
  else
    echo "[3/4] ❌ 임베딩/DB저장 실패: $(date)" | tee -a "$LOG_FILE"
    echo "파이프라인 중단." | tee -a "$LOG_FILE"
    exit 1
  fi
else
  echo "[3/4] ⏭ 임베딩 스킵 (--skip-embed)" | tee -a "$LOG_FILE"
fi

# ── Step 4: 현황 문서 업데이트 ────────────────────────────────
echo "" | tee -a "$LOG_FILE"
echo "[4/4] ▶ 현황 문서 업데이트: $(date)" | tee -a "$LOG_FILE"
echo "-----------------------------------------------------" | tee -a "$LOG_FILE"

if "$PYTHON" scripts/update_pipeline_status.py --company "$COMPANY" 2>&1 | tee -a "$LOG_FILE"; then
  echo "[4/4] ✅ 현황 문서 업데이트 완료" | tee -a "$LOG_FILE"

  # git commit
  cd "$BACKEND_DIR/.."
  if git diff --quiet docs/insurance-pipeline-status.md 2>/dev/null; then
    echo "[4/4] ℹ 문서 변경 없음 (스킵)" | tee -a "$LOG_FILE"
  else
    git add docs/insurance-pipeline-status.md
    git commit -m "docs(pipeline): $COMPANY 파이프라인 완료 현황 업데이트

🗿 MoAI <email@mo.ai.kr>" >> "$LOG_FILE" 2>&1 && \
      git push origin main >> "$LOG_FILE" 2>&1 && \
      echo "[4/4] ✅ git push 완료" | tee -a "$LOG_FILE" || \
      echo "[4/4] ⚠ git push 실패 (로컬 업데이트는 완료)" | tee -a "$LOG_FILE"
  fi
  cd "$BACKEND_DIR"
else
  echo "[4/4] ⚠ 현황 문서 업데이트 실패" | tee -a "$LOG_FILE"
fi

echo "" | tee -a "$LOG_FILE"
echo "=====================================================" | tee -a "$LOG_FILE"
echo "파이프라인 완료: $COMPANY" | tee -a "$LOG_FILE"
echo "종료 시각: $(date)" | tee -a "$LOG_FILE"
echo "로그 파일: $LOG_FILE" | tee -a "$LOG_FILE"
echo "=====================================================" | tee -a "$LOG_FILE"
