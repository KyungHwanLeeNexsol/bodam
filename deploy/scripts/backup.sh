#!/bin/bash
# 데이터베이스 백업 스크립트
# 사용법: bash deploy/scripts/backup.sh
# 크론 설정 예시: 0 3 * * * /home/ubuntu/bodam/deploy/scripts/backup.sh >> /var/log/bodam-backup.log 2>&1

set -euo pipefail

APP_DIR="/home/ubuntu/bodam"
BACKUP_DIR="/data/backups"
COMPOSE_FILE="docker-compose.prod.yml"
KEEP_DAYS=7
DATE=$(date '+%Y%m%d_%H%M%S')
BACKUP_FILE="$BACKUP_DIR/bodam_${DATE}.sql.gz"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 백업 시작"

cd "$APP_DIR"

# 백업 디렉토리 생성
mkdir -p "$BACKUP_DIR"

# env 파일에서 DB 정보 읽기
if [ -f .env.prod ]; then
    # shellcheck disable=SC1091
    source <(grep -E "^(POSTGRES_USER|POSTGRES_DB|POSTGRES_PASSWORD)" .env.prod)
else
    echo "오류: .env.prod 파일이 없습니다"
    exit 1
fi

# PostgreSQL 백업 (컨테이너 내부에서 pg_dump 실행)
echo "PostgreSQL 덤프 생성 중..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
    | gzip > "$BACKUP_FILE"

# 백업 파일 크기 확인
BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "백업 파일 생성 완료: $BACKUP_FILE ($BACKUP_SIZE)"

# 7일 이상 된 백업 파일 삭제
echo "오래된 백업 파일 정리 중 (${KEEP_DAYS}일 초과)..."
find "$BACKUP_DIR" -name "bodam_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete
REMAINING=$(find "$BACKUP_DIR" -name "bodam_*.sql.gz" | wc -l)
echo "남은 백업 파일 수: $REMAINING"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 백업 완료: $BACKUP_FILE"
