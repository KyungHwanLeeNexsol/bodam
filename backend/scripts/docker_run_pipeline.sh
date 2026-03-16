#!/bin/bash
# 도커 컨테이너에서 파이프라인 실행 헬퍼 스크립트
#
# Usage:
#   ./scripts/docker_run_pipeline.sh crawl klia
#   ./scripts/docker_run_pipeline.sh crawl knia
#   ./scripts/docker_run_pipeline.sh crawl all
#   ./scripts/docker_run_pipeline.sh embed
#   ./scripts/docker_run_pipeline.sh status
#   ./scripts/docker_run_pipeline.sh seed-precedents

set -euo pipefail

# 스크립트 디렉토리 기준 프로젝트 루트
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Docker Compose 서비스명 (docker-compose.yml에서 백엔드 서비스)
BACKEND_SERVICE="${BODAM_BACKEND_SERVICE:-backend}"

# Docker Compose 파일 경로
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.yml"

# 색상 코드 (터미널 지원 시)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 로그 함수
log_info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $*"
}

# 사용법 출력
usage() {
    cat <<EOF
보담 플랫폼 파이프라인 Docker 실행 스크립트

사용법:
  $(basename "$0") <명령어> [옵션]

명령어:
  crawl klia          KLIA(생명보험협회) 크롤러 실행
  crawl knia          KNIA(손해보험협회) 크롤러 실행
  crawl all           모든 크롤러 순차 실행
  embed               임베딩 없는 모든 청크 임베딩 생성
  status              데이터베이스 현황 조회
  seed-precedents     개발용 판례 50개 시드

환경변수:
  BODAM_BACKEND_SERVICE  Docker Compose 서비스명 (기본값: backend)

예시:
  ./scripts/docker_run_pipeline.sh status
  ./scripts/docker_run_pipeline.sh crawl klia
  ./scripts/docker_run_pipeline.sh crawl all
  ./scripts/docker_run_pipeline.sh embed
  ./scripts/docker_run_pipeline.sh seed-precedents
EOF
    exit 1
}

# Docker Compose 실행 가능 여부 확인
check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker가 설치되지 않았습니다."
        exit 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Docker 데몬이 실행 중이지 않습니다."
        exit 1
    fi

    # docker compose (v2) 또는 docker-compose (v1) 확인
    if docker compose version &> /dev/null 2>&1; then
        DOCKER_COMPOSE="docker compose"
    elif command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE="docker-compose"
    else
        log_error "docker compose 또는 docker-compose를 찾을 수 없습니다."
        exit 1
    fi

    log_info "Docker Compose: ${DOCKER_COMPOSE}"
}

# 백엔드 컨테이너 실행 여부 확인
check_backend_running() {
    if ! ${DOCKER_COMPOSE} -f "${COMPOSE_FILE}" ps "${BACKEND_SERVICE}" | grep -q "Up"; then
        log_warn "백엔드 컨테이너(${BACKEND_SERVICE})가 실행 중이지 않습니다."
        log_info "컨테이너를 시작합니다..."
        ${DOCKER_COMPOSE} -f "${COMPOSE_FILE}" up -d "${BACKEND_SERVICE}"
        log_info "컨테이너 초기화 대기 중..."
        sleep 5
    fi
}

# 컨테이너에서 Python 스크립트 실행
run_in_container() {
    local script_args="$*"
    log_step "컨테이너 실행: python scripts/${script_args}"

    ${DOCKER_COMPOSE} -f "${COMPOSE_FILE}" exec "${BACKEND_SERVICE}" \
        python "scripts/${script_args}"
}

# 메인 로직
main() {
    if [[ $# -lt 1 ]]; then
        usage
    fi

    local command="$1"
    shift

    check_docker
    check_backend_running

    case "${command}" in
        crawl)
            if [[ $# -lt 1 ]]; then
                log_error "crawl 명령어에는 크롤러 이름이 필요합니다: klia, knia, all"
                usage
            fi

            local crawler="$1"
            case "${crawler}" in
                klia)
                    log_step "KLIA(생명보험협회) 크롤러 실행"
                    run_in_container "run_pipeline.py crawl --crawler klia"
                    ;;
                knia)
                    log_step "KNIA(손해보험협회) 크롤러 실행"
                    run_in_container "run_pipeline.py crawl --crawler knia"
                    ;;
                all)
                    log_step "모든 크롤러 순차 실행"
                    run_in_container "run_pipeline.py crawl --all"
                    ;;
                *)
                    log_error "알 수 없는 크롤러: ${crawler}"
                    log_error "사용 가능한 크롤러: klia, knia, all"
                    exit 1
                    ;;
            esac
            ;;

        embed)
            log_step "임베딩 생성 실행"
            run_in_container "run_pipeline.py embed --all"
            ;;

        status)
            log_step "데이터베이스 현황 조회"
            run_in_container "run_pipeline.py status"
            ;;

        seed-precedents)
            log_step "판례 시드 데이터 생성"
            run_in_container "seed_precedents.py seed"
            ;;

        help|--help|-h)
            usage
            ;;

        *)
            log_error "알 수 없는 명령어: ${command}"
            usage
            ;;
    esac

    log_info "완료!"
}

main "$@"
