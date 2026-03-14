# 보담 플랫폼 재해 복구 런북

## 개요

| 항목 | 목표값 |
|------|--------|
| RTO (복구 시간 목표) | 4시간 이내 |
| RPO (복구 시점 목표) | 1시간 이내 |

이 문서는 보담 플랫폼 운영 중 장애 발생 시 복구 절차를 단계별로 기술합니다.
모든 절차는 프로덕션 환경(`docker-compose.prod.yml`) 기준으로 작성되었습니다.

---

## 섹션 1: PostgreSQL 복구 절차

### 1.1 사전 조건 확인

```bash
# 백업 디렉토리 접근 가능 여부 확인
ls -lh /var/backups/bodam/postgres/

# 백업 스크립트 위치 확인
ls -l scripts/backup/backup_postgres.sh
ls -l scripts/backup/verify_backup.sh
```

### 1.2 사용 가능한 백업 목록 조회

```bash
# 최신 백업 파일 목록 확인 (날짜 기준 정렬)
ls -lt /var/backups/bodam/postgres/*.dump | head -10

# 또는 백업 메타데이터 확인
cat /var/backups/bodam/postgres/latest.json
```

### 1.3 복구 대상 백업 선택

RPO(1시간) 기준으로 장애 발생 시각으로부터 가장 가까운 시점의 백업 파일을 선택합니다.

```bash
# 예: 장애 발생 시각 기준 직전 백업 파일 선택
BACKUP_FILE=/var/backups/bodam/postgres/bodam_2026-03-14_03-00-00.dump
echo "복구 대상 백업: $BACKUP_FILE"
```

### 1.4 백업 파일 무결성 검증

복구 전 반드시 백업 파일의 무결성을 검증합니다.

```bash
# verify_backup.sh로 백업 파일 검증
bash scripts/backup/verify_backup.sh "$BACKUP_FILE"

# 검증 성공 시 출력 예시:
# [OK] 백업 파일 체크섬 일치
# [OK] pg_restore --list 성공
# [OK] 백업 파일 유효
```

검증 실패 시 이전 백업 파일로 재시도합니다.

### 1.5 데이터베이스 복구 (pg_restore)

```bash
# 1. 기존 컨테이너 중지 (앱 서버 포함)
docker compose -f docker-compose.prod.yml stop backend

# 2. PostgreSQL 컨테이너는 유지한 채 대상 DB 삭제 후 재생성
docker compose -f docker-compose.prod.yml exec postgres \
    psql -U "$POSTGRES_USER" -c "DROP DATABASE IF EXISTS $POSTGRES_DB;"
docker compose -f docker-compose.prod.yml exec postgres \
    psql -U "$POSTGRES_USER" -c "CREATE DATABASE $POSTGRES_DB;"

# 3. pg_restore로 복구
docker compose -f docker-compose.prod.yml exec -T postgres \
    pg_restore \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --verbose \
    --no-owner \
    --no-acl \
    < "$BACKUP_FILE"

echo "pg_restore 완료 (종료 코드: $?)"
```

### 1.6 복구 후 검증

```bash
# verify_backup.sh로 복구된 DB 정합성 확인
bash scripts/backup/verify_backup.sh --post-restore

# 주요 테이블 레코드 수 확인
docker compose -f docker-compose.prod.yml exec postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
    "SELECT 'users' AS t, COUNT(*) FROM users
     UNION ALL SELECT 'policies', COUNT(*) FROM policies
     UNION ALL SELECT 'insurance_companies', COUNT(*) FROM insurance_companies;"
```

### 1.7 애플리케이션 재시작

검증 완료 후 섹션 3의 전체 서비스 재시작 절차를 따릅니다.

---

## 섹션 2: Redis 복구 절차

Redis는 **캐시 전용**으로 사용되므로, 데이터 유실 시 재시작 후 캐시를 워밍업합니다.
영속성(AOF/RDB) 설정이 없어 복구보다 재시작이 표준 절차입니다.

### 2.1 Redis 컨테이너 재시작

```bash
# Redis 컨테이너만 재시작
docker compose -f docker-compose.prod.yml restart redis

# 재시작 확인
docker compose -f docker-compose.prod.yml exec redis redis-cli ping
# 출력: PONG
```

### 2.2 캐시 워밍업

Redis 재시작 후 초기에는 캐시 미스(Cache Miss)가 증가합니다.
캐시는 서비스 트래픽에 의해 자동으로 재구성됩니다.

```bash
# 캐시 상태 확인
docker compose -f docker-compose.prod.yml exec redis \
    redis-cli info stats | grep -E "keyspace_hits|keyspace_misses"

# 필요 시 수동 워밍업 스크립트 실행 (존재하는 경우)
# python scripts/warm_cache.py
```

### 2.3 Redis 연결 확인

```bash
# 백엔드 -> Redis 연결 정상 여부 확인
docker compose -f docker-compose.prod.yml exec backend \
    python -c "import redis; r = redis.from_url('$REDIS_URL'); print(r.ping())"
```

---

## 섹션 3: 전체 서비스 재시작 절차

`docker-compose.prod.yml` 기준으로 의존 관계 순서를 지켜 재시작합니다.

### 3.1 재시작 순서

```
PostgreSQL → Redis → Backend → (Nginx/Proxy)
```

### 3.2 단계별 재시작 명령

```bash
# 1. 모든 서비스 중지
docker compose -f docker-compose.prod.yml down

# 2. PostgreSQL 먼저 기동 및 헬스 확인
docker compose -f docker-compose.prod.yml up -d postgres
sleep 10
docker compose -f docker-compose.prod.yml exec postgres pg_isready
# 출력: /var/run/postgresql:5432 - accepting connections

# 3. Redis 기동
docker compose -f docker-compose.prod.yml up -d redis
sleep 5

# 4. DB 마이그레이션 적용 (미적용 마이그레이션 있을 경우)
docker compose -f docker-compose.prod.yml run --rm backend \
    alembic upgrade head

# 5. 백엔드 기동
docker compose -f docker-compose.prod.yml up -d backend

# 6. 헬스 체크 (최대 60초 대기)
for i in $(seq 1 12); do
    if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
        echo "[OK] 백엔드 헬스 체크 통과"
        break
    fi
    echo "[$i/12] 헬스 체크 대기 중..."
    sleep 5
done

# 7. 전체 서비스 상태 확인
docker compose -f docker-compose.prod.yml ps
```

### 3.3 서비스 정상 확인

```bash
# 컨테이너 상태 확인
docker compose -f docker-compose.prod.yml ps

# 로그 확인 (최근 50줄)
docker compose -f docker-compose.prod.yml logs --tail=50 backend
docker compose -f docker-compose.prod.yml logs --tail=20 postgres
docker compose -f docker-compose.prod.yml logs --tail=20 redis
```

---

## 섹션 4: 장애 체크리스트

### 4.1 장애 발생 전 (사전 준비)

- [ ] 백업 스크립트(`backup_postgres.sh`) 크론 등록 확인 (매시간 권장)
- [ ] 백업 파일 저장 경로 디스크 여유 공간 확인 (최소 10GB)
- [ ] `verify_backup.sh` 정기 실행 확인 (주 1회 권장)
- [ ] `.env.prod` 파일 안전한 별도 장소에 백업
- [ ] 도커 이미지 레지스트리 접근 가능 여부 확인
- [ ] 복구 절차 최소 분기 1회 드릴(Dry-run) 수행

### 4.2 장애 발생 중 (대응 절차)

- [ ] 장애 발생 시각 기록
- [ ] 장애 범위 파악 (DB/Redis/Backend/Network)
- [ ] 서비스 상태 스냅샷 저장: `docker compose ps > incident_$(date +%s).txt`
- [ ] 에러 로그 수집: `docker compose logs > logs_$(date +%s).txt`
- [ ] 해당 섹션의 복구 절차 실행
- [ ] 복구 진행 상황 슬랙/이메일로 공유

### 4.3 장애 복구 후 (사후 조치)

- [ ] 서비스 정상화 확인 (헬스 체크 통과)
- [ ] 주요 API 동작 확인 (`/health`, `/api/v1/policies`)
- [ ] 데이터 무결성 확인 (레코드 수 비교)
- [ ] 장애 원인 분석 및 포스트모텀 작성
- [ ] 재발 방지 조치 계획 수립
- [ ] 백업 정책 재검토 (필요 시 빈도 조정)
- [ ] 런북 업데이트 (발견된 개선 사항 반영)

---

## 섹션 5: 연락처 및 에스컬레이션

> 현재 1인 운영 체제이므로, 향후 팀 확장 시 아래 템플릿을 채워 주세요.

### 5.1 담당자 정보

| 역할 | 이름 | 연락처 | 비고 |
|------|------|--------|------|
| 인프라 담당 | (담당자명) | (연락처) | 주 담당 |
| 백업 담당 | (담당자명) | (연락처) | 인프라 담당 부재 시 |

### 5.2 에스컬레이션 절차

```
1단계: 자동 알림 확인 (모니터링 대시보드, 이메일 알림)
       ↓ (10분 이내 미해결)
2단계: 담당자 직접 대응
       ↓ (30분 이내 미해결)
3단계: 에스컬레이션 (팀 리드 / 외부 지원 요청)
       ↓ (2시간 이내 미해결)
4단계: 서비스 중단 공지 및 전문 지원 요청
```

### 5.3 외부 서비스 연락처

| 서비스 | 지원 채널 | 비고 |
|--------|-----------|------|
| 클라우드 인프라 | (지원 포털 URL) | 인프라 장애 시 |
| 도메인/DNS | (지원 연락처) | DNS 장애 시 |
| 이메일 발송 서비스 | (지원 연락처) | 알림 장애 시 |

---

*마지막 업데이트: 2026-03-14*
*버전: 1.0.0*
