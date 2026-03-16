#!/bin/bash
# 롤백 스크립트 - 이전 Docker 이미지로 되돌리기
# 사용법: bash deploy/scripts/rollback.sh

set -euo pipefail

APP_DIR="/home/ubuntu/bodam"
COMPOSE_FILE="docker-compose.prod.yml"

echo "=========================================="
echo " 보담 롤백 스크립트"
echo "=========================================="

cd "$APP_DIR"

# 최근 git 커밋 목록 출력
echo "최근 커밋 이력:"
echo "---"
git log --oneline -10
echo "---"
echo ""

# 현재 실행 중인 이미지 확인
echo "현재 실행 중인 컨테이너:"
docker compose -f "$COMPOSE_FILE" ps
echo ""

# 롤백할 커밋 입력 받기
read -rp "롤백할 커밋 해시를 입력하세요 (예: abc1234, 또는 'exit'로 취소): " TARGET_COMMIT

if [ "$TARGET_COMMIT" = "exit" ] || [ -z "$TARGET_COMMIT" ]; then
    echo "롤백이 취소되었습니다."
    exit 0
fi

# 커밋 유효성 검증
if ! git cat-file -e "${TARGET_COMMIT}^{commit}" 2>/dev/null; then
    echo "오류: 유효하지 않은 커밋 해시입니다: $TARGET_COMMIT"
    exit 1
fi

echo ""
echo "롤백 커밋: $TARGET_COMMIT"
echo "커밋 내용: $(git log --oneline -1 "$TARGET_COMMIT")"
read -rp "정말로 롤백하시겠습니까? (y/N): " CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "롤백이 취소되었습니다."
    exit 0
fi

# 현재 상태 저장
CURRENT_COMMIT=$(git rev-parse --short HEAD)
echo ""
echo "현재 커밋 ($CURRENT_COMMIT) -> 롤백 커밋 ($TARGET_COMMIT)"

# 컨테이너 중지
echo "[1/3] 컨테이너 중지 중..."
docker compose -f "$COMPOSE_FILE" down

# 코드 롤백
echo "[2/3] 코드 롤백 중..."
git checkout "$TARGET_COMMIT"

# 이미지 재빌드 및 시작
echo "[3/3] Docker 이미지 재빌드 및 시작 중..."
docker compose -f "$COMPOSE_FILE" build backend
docker compose -f "$COMPOSE_FILE" up -d

# 헬스체크
echo "헬스체크 검증 중..."
sleep 15
if curl -sf http://localhost:8000/api/v1/health > /dev/null 2>&1; then
    echo "롤백 성공!"
else
    echo "경고: 헬스체크 실패. 컨테이너 로그를 확인하세요:"
    docker compose -f "$COMPOSE_FILE" logs backend --tail=30
    exit 1
fi

echo ""
echo "=========================================="
echo " 롤백 완료!"
echo " 시각: $(date '+%Y-%m-%d %H:%M:%S')"
echo " 복원된 커밋: $(git rev-parse --short HEAD)"
echo "=========================================="
