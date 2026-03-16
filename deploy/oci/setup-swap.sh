#!/bin/bash
# OCI VM 스왑 설정 스크립트 (1GB RAM 인스턴스용)
# 사용법: sudo bash setup-swap.sh
# 2GB 스왑 파일 생성 (RAM 부족 시 디스크로 보완)

set -euo pipefail

SWAP_SIZE="2G"
SWAP_FILE="/swapfile"

echo "=========================================="
echo " Swap 설정 시작 (OCI Free Tier 1GB RAM)"
echo "=========================================="

# 기존 스왑 확인
if swapon --show | grep -q "$SWAP_FILE"; then
    echo "이미 스왑이 설정되어 있습니다:"
    swapon --show
    free -h
    exit 0
fi

# 1. 스왑 파일 생성
echo "[1/5] ${SWAP_SIZE} 스왑 파일 생성 중... (시간이 걸릴 수 있습니다)"
fallocate -l $SWAP_SIZE $SWAP_FILE
chmod 600 $SWAP_FILE
echo "스왑 파일 생성 완료"

# 2. 스왑 영역 포맷
echo "[2/5] 스왑 영역 포맷 중..."
mkswap $SWAP_FILE
echo "포맷 완료"

# 3. 스왑 활성화
echo "[3/5] 스왑 활성화 중..."
swapon $SWAP_FILE
echo "스왑 활성화 완료"

# 4. 부팅 시 자동 마운트 설정
echo "[4/5] 부팅 시 자동 마운트 설정 중..."
if ! grep -q "$SWAP_FILE" /etc/fstab; then
    echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
    echo "fstab 등록 완료"
else
    echo "fstab에 이미 등록되어 있습니다"
fi

# 5. 스왑 사용 빈도 조정 (swappiness: 기본 60 → 10)
# 값이 낮을수록 RAM 우선 사용, 스왑은 최후 수단으로만 사용
echo "[5/5] swappiness 조정 중 (60 → 10)..."
sysctl vm.swappiness=10
if ! grep -q "vm.swappiness" /etc/sysctl.conf; then
    echo "vm.swappiness=10" >> /etc/sysctl.conf
fi

# vfs_cache_pressure 조정: 파일 시스템 캐시를 더 오래 유지
sysctl vm.vfs_cache_pressure=50
if ! grep -q "vm.vfs_cache_pressure" /etc/sysctl.conf; then
    echo "vm.vfs_cache_pressure=50" >> /etc/sysctl.conf
fi

echo ""
echo "=========================================="
echo " Swap 설정 완료!"
echo "=========================================="
echo ""
echo "현재 메모리 상태:"
free -h
echo ""
echo "스왑 정보:"
swapon --show
