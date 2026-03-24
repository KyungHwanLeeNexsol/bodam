#!/usr/bin/env bash
# 보험사별 순차 파이프라인
#
# 처리 순서 (1개 보험사 단위):
#   [1/4] 크롤링          — 판매중/판매중지 PDF 수집
#   [2/4] 수집 결과 검증  — ON_SALE/DISCONTINUED 정확도 확인 (실패 시 중단)
#   [3/4] 인제스트+임베딩 — CockroachDB 저장 + 벡터 생성
#   [4/4] 현황문서 업데이트 — docs/insurance-pipeline-status.md 갱신 + git push
#
# 사용법:
#   bash scripts/run_ingest_pipeline.sh --company lotte_insurance
#   bash scripts/run_ingest_pipeline.sh --company axa_general --skip-crawl
#   bash scripts/run_ingest_pipeline.sh --company nh_fire --strict-verify
#   bash scripts/run_ingest_pipeline.sh --company mg_insurance --no-fail-discontinued
#   nohup bash scripts/run_ingest_pipeline.sh --company lotte_insurance \
#       > data/pipeline_lotte.log 2>&1 &

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
PYTHON="/c/Users/Nexsol/AppData/Local/Programs/Python/Python312/python.exe"
LOG_DIR="$BACKEND_DIR/data"
TIMESTAMP="$(date '+%Y%m%d_%H%M%S')"

# ── 인수 파싱 ─────────────────────────────────────────────────
COMPANY=""
SKIP_CRAWL=false
SKIP_VERIFY=false
SKIP_INGEST=false
STRICT_VERIFY=false
NO_FAIL_DISCONTINUED=false
WARN_IS_FAIL=false   # true: WARN(exit 2)도 파이프라인 중단

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
    --skip-verify)
      SKIP_VERIFY=true
      shift
      ;;
    --skip-ingest)
      SKIP_INGEST=true
      shift
      ;;
    --strict-verify)
      STRICT_VERIFY=true
      shift
      ;;
    --no-fail-discontinued)
      NO_FAIL_DISCONTINUED=true
      shift
      ;;
    --warn-is-fail)
      WARN_IS_FAIL=true
      shift
      ;;
    *)
      echo "알 수 없는 옵션: $1"
      echo ""
      echo "사용법: $0 --company <company_id> [옵션]"
      echo ""
      echo "옵션:"
      echo "  --skip-crawl          크롤링 스킵 (로컬 데이터 재사용)"
      echo "  --skip-verify         검증 스킵 (비권장)"
      echo "  --skip-ingest         인제스트/임베딩 스킵"
      echo "  --strict-verify       UNKNOWN 1개라도 있으면 FAIL"
      echo "  --no-fail-discontinued DISCONTINUED 0개여도 경고 생략"
      echo "  --warn-is-fail        WARN도 파이프라인 중단 처리"
      echo ""
      echo "지원 보험사 코드 (Group A - crawl_nonlife_playwright.py):"
      echo "  lotte_insurance, axa_general, nh_fire, mg_insurance, heungkuk_fire"
      echo "  hyundai_marine, db_insurance, kb_insurance, meritz_fire, hanwha_general"
      exit 1
      ;;
  esac
done

if [[ -z "$COMPANY" ]]; then
  echo "오류: --company 옵션이 필요합니다."
  echo "예시: $0 --company lotte_insurance"
  exit 1
fi

LOG_FILE="$LOG_DIR/pipeline_${COMPANY}_${TIMESTAMP}.log"

# ── 헬퍼 함수 ────────────────────────────────────────────────
log() {
  echo "$@" | tee -a "$LOG_FILE"
}

log_step() {
  local step="$1"
  local msg="$2"
  log ""
  log "[$step] $msg"
  log "-----------------------------------------------------"
}

fail_pipeline() {
  log ""
  log "======================================================"
  log "파이프라인 중단: $COMPANY"
  log "원인: $1"
  log "종료 시각: $(date)"
  log "로그 파일: $LOG_FILE"
  log "======================================================"
  exit 1
}

cd "$BACKEND_DIR"

log "======================================================"
log "파이프라인 시작: $COMPANY"
log "시작 시각: $(date)"
log "로그: $LOG_FILE"
log "======================================================"

# ── [1/4] 크롤링 ─────────────────────────────────────────────
if [[ "$SKIP_CRAWL" == "true" ]]; then
  log_step "1/4" "크롤링 스킵 (--skip-crawl, 기존 로컬 데이터 사용)"
else
  log_step "1/4" "크롤링 시작: $(date)"

  CRAWL_CMD="$PYTHON scripts/crawl_nonlife_playwright.py --company $COMPANY"
  log "실행: $CRAWL_CMD"

  if PYTHONIOENCODING=utf-8 PYTHONPATH=. $CRAWL_CMD 2>&1 | tee -a "$LOG_FILE"; then
    log "[1/4] ✅ 크롤링 완료: $(date)"
  else
    fail_pipeline "크롤링 실패 (exit code $?)"
  fi
fi

# ── [2/4] 수집 결과 검증 ──────────────────────────────────────
if [[ "$SKIP_VERIFY" == "true" ]]; then
  log_step "2/4" "검증 스킵 (--skip-verify)"
  log "  ⚠ 경고: 검증 스킵은 잘못된 데이터가 인제스트될 위험이 있습니다."
else
  log_step "2/4" "수집 결과 검증: $(date)"

  VERIFY_ARGS="--company $COMPANY"
  if [[ "$STRICT_VERIFY" == "true" ]]; then
    VERIFY_ARGS="$VERIFY_ARGS --strict"
  fi
  if [[ "$NO_FAIL_DISCONTINUED" == "true" ]]; then
    VERIFY_ARGS="$VERIFY_ARGS --no-fail-on-no-discontinued"
  fi

  VERIFY_CMD="$PYTHON scripts/verify_crawl_result.py $VERIFY_ARGS"
  log "실행: $VERIFY_CMD"

  set +e
  PYTHONIOENCODING=utf-8 PYTHONPATH=. $VERIFY_CMD 2>&1 | tee -a "$LOG_FILE"
  VERIFY_EXIT=$?
  set -e

  if [[ $VERIFY_EXIT -eq 0 ]]; then
    log "[2/4] ✅ 검증 통과: 판매중/판매중지 정상 수집 확인"

  elif [[ $VERIFY_EXIT -eq 2 ]]; then
    # WARN: 파이프라인은 계속, 단 --warn-is-fail 옵션이면 중단
    if [[ "$WARN_IS_FAIL" == "true" ]]; then
      fail_pipeline "검증 경고를 오류로 처리 (--warn-is-fail)"
    else
      log "[2/4] ⚠ 검증 경고 — 파이프라인 계속 진행"
      log "  수동으로 데이터를 확인한 후 인제스트를 진행하는 것이 권장됩니다."
    fi

  else
    # exit code 1 또는 다른 오류
    fail_pipeline "검증 실패 (exit code $VERIFY_EXIT) — 수집 데이터를 확인하고 재크롤링하세요."
  fi
fi

# ── [3/4] 인제스트 + 임베딩 DB저장 ───────────────────────────
if [[ "$SKIP_INGEST" == "true" ]]; then
  log_step "3/4" "인제스트+임베딩 스킵 (--skip-ingest)"
else
  log_step "3/4" "인제스트 + 임베딩 시작: $(date)"
  log "  판매중/판매중지 PDF → CockroachDB 저장 + 벡터 임베딩"

  INGEST_CMD="$PYTHON scripts/ingest_local_pdfs.py --company $COMPANY --embed"
  log "실행: $INGEST_CMD"

  if PYTHONIOENCODING=utf-8 PYTHONPATH=. $INGEST_CMD 2>&1 | tee -a "$LOG_FILE"; then
    log "[3/4] ✅ 인제스트+임베딩 완료: $(date)"
  else
    fail_pipeline "인제스트 실패 (exit code $?)"
  fi
fi

# ── [4/4] 현황문서 업데이트 ──────────────────────────────────
log_step "4/4" "현황 문서 업데이트: $(date)"

UPDATE_CMD="$PYTHON scripts/update_pipeline_status.py --company $COMPANY"
log "실행: $UPDATE_CMD"

if PYTHONIOENCODING=utf-8 PYTHONPATH=. $UPDATE_CMD 2>&1 | tee -a "$LOG_FILE"; then
  log "[4/4] ✅ 현황 문서 업데이트 완료"

  # git commit + push
  REPO_ROOT="$BACKEND_DIR/.."
  cd "$REPO_ROOT"

  STATUS_DOC="docs/insurance-pipeline-status.md"
  if git diff --quiet "$STATUS_DOC" 2>/dev/null; then
    log "[4/4] ℹ 현황 문서 변경 없음 (git 스킵)"
  else
    git add "$STATUS_DOC"
    git commit -m "docs(pipeline): $COMPANY 파이프라인 완료 현황 업데이트

🗿 MoAI <email@mo.ai.kr>" >> "$LOG_FILE" 2>&1 && \
      git push origin main >> "$LOG_FILE" 2>&1 && \
      log "[4/4] ✅ git push 완료" || \
      log "[4/4] ⚠ git push 실패 (로컬 업데이트는 완료)"
  fi

  cd "$BACKEND_DIR"
else
  log "[4/4] ⚠ 현황 문서 업데이트 실패 (인제스트 자체는 완료)"
fi

# ── 완료 ─────────────────────────────────────────────────────
log ""
log "======================================================"
log "파이프라인 완료: $COMPANY"
log "종료 시각: $(date)"
log "로그 파일: $LOG_FILE"
log "======================================================"
