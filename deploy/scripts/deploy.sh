#!/bin/bash
# 수동 배포 스크립트 (OCI VM에서 직접 실행)
# 사용법: bash deploy/scripts/deploy.sh

set -euo pipefail

APP_DIR="/home/ubuntu/bodam"
COMPOSE_FILE="docker-compose.prod.yml"
HEALTH_URL="http://localhost:8000/api/v1/health"

echo "=========================================="
echo " 보담 수동 배포 시작"
echo " 시각: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

cd "$APP_DIR"

# 1. 현재 상태 저장 (롤백용)
echo "[1/5] 현재 상태 저장 중..."
CURRENT_COMMIT=$(git rev-parse --short HEAD)
echo "현재 커밋: $CURRENT_COMMIT"

# 2. 최신 코드 가져오기
echo "[2/5] 최신 코드 가져오는 중..."
git pull origin main
NEW_COMMIT=$(git rev-parse --short HEAD)
echo "업데이트된 커밋: $NEW_COMMIT"

# 3. Docker 이미지 빌드 및 컨테이너 재시작
echo "[3/5] Docker 이미지 빌드 중..."
docker compose -f "$COMPOSE_FILE" build backend
echo "빌드 완료"

echo "컨테이너 시작 중..."
docker compose -f "$COMPOSE_FILE" up -d
echo "컨테이너 시작 완료"

# 4. 헬스체크 검증
echo "[4/5] 헬스체크 검증 중 (최대 60초 대기)..."
MAX_WAIT=60
WAIT=0
HEALTH_OK=false

while [ "$WAIT" -lt "$MAX_WAIT" ]; do
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
        HEALTH_OK=true
        echo "헬스체크 통과! (${WAIT}초 후)"
        break
    fi
    echo "  대기 중... (${WAIT}s / ${MAX_WAIT}s)"
    sleep 5
    WAIT=$((WAIT + 5))
done

if [ "$HEALTH_OK" = false ]; then
    echo "오류: 헬스체크 실패. 배포를 롤백합니다..."
    docker compose -f "$COMPOSE_FILE" down
    git checkout "$CURRENT_COMMIT"
    docker compose -f "$COMPOSE_FILE" up -d
    echo "롤백 완료. 커밋 $CURRENT_COMMIT 으로 되돌렸습니다."
    exit 1
fi

# 5. 상태 출력
echo "[5/5] 배포 상태 확인..."
echo ""
docker compose -f "$COMPOSE_FILE" ps
echo ""
echo "헬스체크 응답:"
curl -s "$HEALTH_URL" | python3 -m json.tool 2>/dev/null || curl -s "$HEALTH_URL"

echo ""
echo "=========================================="
echo " 배포 완료!"
echo " 시각: $(date '+%Y-%m-%d %H:%M:%S')"
echo " 커밋: $NEW_COMMIT"
echo "=========================================="
