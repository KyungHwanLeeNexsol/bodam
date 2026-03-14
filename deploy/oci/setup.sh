#!/bin/bash
# 보담 OCI 서버 초기 설정 스크립트 (Ubuntu 22.04 ARM64)
# 사용법: sudo bash setup.sh

set -euo pipefail

echo "=========================================="
echo " 보담 서버 초기 설정 시작 (Ubuntu 22.04 ARM64)"
echo "=========================================="

# 1. 시스템 업데이트
echo "[1/8] 시스템 패키지 업데이트..."
apt-get update -y
apt-get upgrade -y
apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    git \
    htop \
    vim \
    unzip

# 2. Docker Engine 설치 (ARM64용 공식 방법)
echo "[2/8] Docker Engine 설치 중 (ARM64)..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io

# Docker 서비스 시작 및 부팅 시 자동 시작 설정
systemctl enable docker
systemctl start docker

echo "Docker 설치 완료: $(docker --version)"

# 3. Docker Compose v2 플러그인 설치
echo "[3/8] Docker Compose v2 플러그인 설치 중..."
apt-get install -y docker-compose-plugin

echo "Docker Compose 설치 완료: $(docker compose version)"

# 4. Nginx 설치
echo "[4/8] Nginx 설치 중..."
apt-get install -y nginx
systemctl enable nginx
systemctl start nginx

echo "Nginx 설치 완료: $(nginx -v 2>&1)"

# 5. Certbot + python3-certbot-nginx 설치
echo "[5/8] Certbot 설치 중..."
apt-get install -y python3 python3-pip
apt-get install -y certbot python3-certbot-nginx

echo "Certbot 설치 완료: $(certbot --version)"

# 6. ufw 방화벽 설정 (22, 80, 443 허용)
echo "[6/8] UFW 방화벽 설정 중..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

echo "방화벽 설정 완료:"
ufw status verbose

# 7. ubuntu 유저를 docker 그룹에 추가
echo "[7/8] ubuntu 유저를 docker 그룹에 추가 중..."
usermod -aG docker ubuntu
echo "ubuntu 유저가 docker 그룹에 추가되었습니다. 다음 SSH 접속 시 적용됩니다."

# 8. 애플리케이션 디렉토리 생성 (/opt/bodam)
echo "[8/8] 애플리케이션 디렉토리 생성 중..."
mkdir -p /opt/bodam
chown ubuntu:ubuntu /opt/bodam
chmod 755 /opt/bodam

echo ""
echo "=========================================="
echo " 초기 설정 완료!"
echo "=========================================="
echo ""
echo "다음 단계:"
echo "  1. SSH 재접속 (docker 그룹 권한 적용)"
echo "  2. git clone https://github.com/YOUR_ORG/bodam /opt/bodam"
echo "  3. .env.prod 파일 설정"
echo "  4. bash /opt/bodam/deploy/oci/deploy.sh"
echo ""
echo "도메인이 없는 경우:"
echo "  서버 IP를 확인하고 IP.nip.io 형식으로 사용 가능"
echo "  예: 141.148.100.200.nip.io"
