#!/bin/bash
# SSL 인증서 갱신 스크립트 (Let's Encrypt)
# 사용법: sudo bash deploy/scripts/ssl-renew.sh
# 크론 설정 예시: 0 0 1 * * sudo /home/ubuntu/bodam/deploy/scripts/ssl-renew.sh >> /var/log/ssl-renew.log 2>&1

set -euo pipefail

echo "[$(date '+%Y-%m-%d %H:%M:%S')] SSL 인증서 갱신 시작"

# Certbot으로 인증서 갱신 시도
# webroot 방식 사용 (Nginx가 실행 중인 상태에서 갱신)
certbot renew \
    --webroot \
    --webroot-path=/var/www/certbot \
    --non-interactive \
    --agree-tos \
    --quiet

CERTBOT_EXIT=$?

if [ $CERTBOT_EXIT -eq 0 ]; then
    echo "인증서 갱신 성공 (또는 갱신 불필요)"

    # Nginx 설정 리로드 (새 인증서 적용)
    # Docker 컨테이너 내 Nginx 리로드
    APP_DIR="/home/ubuntu/bodam"
    COMPOSE_FILE="docker-compose.prod.yml"

    cd "$APP_DIR"
    docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload

    echo "Nginx 리로드 완료"
else
    echo "오류: certbot 갱신 실패 (exit code: $CERTBOT_EXIT)"
    exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] SSL 인증서 갱신 완료"
