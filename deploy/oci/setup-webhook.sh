#!/bin/bash
# OCI VM에 webhook 데몬 설치 및 설정 스크립트
# 실행: sudo bash deploy/oci/setup-webhook.sh
set -euo pipefail

WEBHOOK_VERSION="2.8.1"
WEBHOOK_SECRET="${1:-WEBHOOK_SECRET_CHANGE_ME}"
APP_DIR="/home/ubuntu/bodam"
HOOKS_FILE="$APP_DIR/deploy/webhook/hooks.json"
SERVICE_FILE="/etc/systemd/system/bodam-webhook.service"

echo "=== webhook 데몬 설치 ==="

# ARM64 바이너리 다운로드
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ]; then
    BINARY="webhook-linux-arm64"
else
    BINARY="webhook-linux-amd64"
fi

wget -q "https://github.com/adnanh/webhook/releases/download/${WEBHOOK_VERSION}/${BINARY}.tar.gz" -O /tmp/webhook.tar.gz
tar -xzf /tmp/webhook.tar.gz -C /tmp
sudo mv "/tmp/${BINARY}/webhook" /usr/local/bin/webhook
sudo chmod +x /usr/local/bin/webhook
rm -rf /tmp/webhook.tar.gz "/tmp/${BINARY}"

echo "webhook 버전: $(webhook --version)"

echo "=== hooks.json에 실제 시크릿 적용 ==="
sed -i "s/WEBHOOK_SECRET_CHANGE_ME/$WEBHOOK_SECRET/g" "$HOOKS_FILE"
echo "시크릿 적용 완료"

echo "=== systemd 서비스 등록 ==="
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Bodam Webhook Deployment Daemon
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=$APP_DIR
ExecStart=/usr/local/bin/webhook -hooks $HOOKS_FILE -port 9000 -hotreload -verbose
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=bodam-webhook

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable bodam-webhook
sudo systemctl start bodam-webhook

echo ""
echo "=== 설치 완료 ==="
echo "서비스 상태:"
sudo systemctl status bodam-webhook --no-pager

echo ""
echo "=== GitHub Webhook 설정 방법 ==="
echo "GitHub 레포 → Settings → Webhooks → Add webhook"
echo "  Payload URL: https://yourdomain.com/webhooks/deploy-bodam"
echo "  Content type: application/json"
echo "  Secret: $WEBHOOK_SECRET"
echo "  Events: Just the push event"
echo ""
echo "OCI Security List에 포트 9000 인바운드 규칙 추가 불필요"
echo "(Nginx가 HTTPS로 프록시하므로 내부 통신만 사용)"
