#!/bin/bash
# Docker Engine + Docker Compose 플러그인 설치 스크립트 (Ubuntu 22.04 ARM64)
# 사용법: sudo bash install-docker.sh

set -euo pipefail

echo "=== Docker 설치 시작 (Ubuntu 22.04 ARM64) ==="

# 기존 버전 제거
echo "[1/5] 기존 Docker 버전 제거 중..."
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# 필수 패키지 설치
echo "[2/5] 필수 패키지 설치 중..."
apt-get update -y
apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Docker 공식 GPG 키 추가
echo "[3/5] Docker 공식 저장소 설정 중..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Docker 저장소 추가 (ARM64 호환)
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# Docker Engine 설치
echo "[4/5] Docker Engine 설치 중..."
apt-get update -y
apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

# Docker 서비스 활성화
systemctl enable docker
systemctl start docker

# ubuntu 유저를 docker 그룹에 추가 (sudo 없이 docker 사용)
echo "[5/5] docker 그룹 설정 중..."
usermod -aG docker ubuntu

echo ""
echo "=== Docker 설치 완료 ==="
echo "Docker 버전: $(docker --version)"
echo "Docker Compose 버전: $(docker compose version)"
echo ""
echo "주의: docker 그룹 권한은 SSH 재접속 후 적용됩니다."
echo "검증: docker run hello-world"
