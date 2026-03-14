#!/bin/bash
# 보담 앱 배포 스크립트 (OCI 서버에서 실행)
# 사용법: bash /opt/bodam/deploy/oci/deploy.sh

set -euo pipefail

APP_DIR=/opt/bodam

echo "=========================================="
echo " 보담 배포 시작"
echo " 시각: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

cd "$APP_DIR"

# 1. 최신 코드 가져오기
echo "[1/6] 최신 코드 가져오는 중..."
git pull origin main
echo "코드 업데이트 완료. 현재 커밋: $(git rev-parse --short HEAD)"

# 2. 최신 이미지 빌드 및 시작
echo "[2/6] Docker 이미지 빌드 및 컨테이너 시작 중..."
docker compose -f docker-compose.prod.yml up -d --build
echo "컨테이너 시작 완료"

# 3. 백엔드 컨테이너가 헬스체크를 통과할 때까지 대기
echo "[3/6] 백엔드 서비스 준비 대기 중..."
MAX_WAIT=60
WAIT=0
until docker compose -f docker-compose.prod.yml exec -T backend curl -sf http://localhost:8000/health > /dev/null 2>&1; do
    if [ "$WAIT" -ge "$MAX_WAIT" ]; then
        echo "오류: 백엔드 서비스가 ${MAX_WAIT}초 내에 응답하지 않습니다."
        docker compose -f docker-compose.prod.yml logs backend --tail=50
        exit 1
    fi
    echo "  대기 중... (${WAIT}s / ${MAX_WAIT}s)"
    sleep 5
    WAIT=$((WAIT + 5))
done
echo "백엔드 서비스 준비 완료"

# 4. 데이터베이스 마이그레이션 실행
echo "[4/6] 데이터베이스 마이그레이션 실행 중..."
docker compose -f docker-compose.prod.yml exec -T backend uv run alembic upgrade head
echo "마이그레이션 완료"

# 5. 오래된 Docker 이미지 및 컨테이너 정리
echo "[5/6] 오래된 Docker 리소스 정리 중..."
docker system prune -f
echo "정리 완료"

# 6. 배포 상태 확인
echo "[6/6] 배포 상태 확인..."
echo ""
docker compose -f docker-compose.prod.yml ps
echo ""

echo "=========================================="
echo " 배포 완료!"
echo " 시각: $(date '+%Y-%m-%d %H:%M:%S')"
echo " 커밋: $(git rev-parse --short HEAD)"
echo "=========================================="
