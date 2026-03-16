# 보담 OCI 배포 가이드

Oracle Cloud Free Tier VM.Standard.E2.1.Micro (1 OCPU, 1GB RAM) 기준 배포 가이드입니다.

- **서버 IP**: `134.185.103.92`
- **도메인**: `134.185.103.92.nip.io` (nip.io 무료 DNS)
- **HTTPS**: `https://134.185.103.92.nip.io`
- **OS**: Ubuntu 22.04
- **배포 방식**: GitHub push → webhook → deploy.sh 자동 실행

---

## 1단계: OCI Security List 포트 개방

OCI 콘솔에서 인바운드 규칙을 추가해야 합니다.

1. OCI 콘솔 → Networking → Virtual Cloud Networks
2. 인스턴스의 VCN 클릭
3. Security Lists → Default Security List
4. "Add Ingress Rules" 에서 다음 추가:

| 소스 CIDR | 프로토콜 | 포트 범위 | 설명 |
|-----------|---------|----------|------|
| 0.0.0.0/0 | TCP | 22 | SSH |
| 0.0.0.0/0 | TCP | 80 | HTTP |
| 0.0.0.0/0 | TCP | 443 | HTTPS |

---

## 2단계: SSH 접속

```bash
ssh -i ~/.ssh/your-oci-key.pem ubuntu@134.185.103.92
```

---

## 3단계: 서버 초기 설정

```bash
# 패키지 업데이트 + Docker + Nginx + Certbot + UFW 설치
sudo apt-get update -y && sudo apt-get install -y git
git clone https://github.com/YOUR_ORG/bodam /home/ubuntu/bodam
sudo bash /home/ubuntu/bodam/deploy/oci/setup.sh
```

SSH 재접속 (docker 그룹 권한 적용):
```bash
exit
ssh -i ~/.ssh/your-oci-key.pem ubuntu@134.185.103.92
```

---

## 4단계: Swap 설정 (1GB RAM 보완 - 필수)

1GB RAM만으로는 컨테이너 4개(postgres + redis + backend + nginx) 실행이 불가능합니다.
2GB Swap을 추가합니다.

```bash
sudo bash /home/ubuntu/bodam/deploy/oci/setup-swap.sh
```

완료 후 메모리 확인:
```bash
free -h
# Swap: 2.0G 가 표시되면 정상
```

---

## 5단계: .env.prod 파일 작성

```bash
cd /home/ubuntu/bodam
cp .env.prod.example .env.prod
nano .env.prod
```

필수 변경 항목:

| 항목 | 생성 방법 |
|------|-----------|
| `POSTGRES_PASSWORD` | 강력한 비밀번호 직접 입력 |
| `REDIS_PASSWORD` | 강력한 비밀번호 직접 입력 |
| `DATABASE_URL` | POSTGRES_PASSWORD와 동일하게 수정 |
| `REDIS_URL` | REDIS_PASSWORD와 동일하게 수정 |
| `SECRET_KEY` | `openssl rand -hex 32` 실행 후 복붙 |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `GOOGLE_API_KEY` | Google Gemini API 키 |
| `MINIO_ENDPOINT` | Cloudflare R2 엔드포인트 |
| `MINIO_ACCESS_KEY` | R2 Access Key |
| `MINIO_SECRET_KEY` | R2 Secret Key |
| `SOCIAL_TOKEN_ENCRYPTION_KEY` | `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |

`ALLOWED_ORIGINS`와 도메인 관련 항목은 이미 `134.185.103.92.nip.io`로 설정되어 있습니다.

---

## 6단계: SSL 인증서 발급 (Let's Encrypt)

Nginx 컨테이너 없이 먼저 certbot으로 인증서를 발급받아야 합니다.

```bash
# certbot 직접 실행 (standalone 모드 - 80포트 임시 점유)
sudo certbot certonly --standalone \
  -d 134.185.103.92.nip.io \
  --non-interactive \
  --agree-tos \
  --email your@email.com
```

발급 확인:
```bash
sudo ls /etc/letsencrypt/live/134.185.103.92.nip.io/
# fullchain.pem, privkey.pem 이 있으면 성공
```

---

## 7단계: 첫 배포 실행

```bash
cd /home/ubuntu/bodam
bash deploy/scripts/deploy.sh
```

컨테이너 상태 확인:
```bash
docker compose -f docker-compose.prod.yml ps
```

API 헬스체크:
```bash
curl https://134.185.103.92.nip.io/api/v1/health
```

---

## 8단계: GitHub Webhook 설정 (자동 배포)

서버에서 webhook 데몬 설치:
```bash
# YOUR_SECRET은 임의의 강력한 문자열로 직접 지정
sudo bash /home/ubuntu/bodam/deploy/oci/setup-webhook.sh YOUR_SECRET
```

GitHub 레포에서 Webhook 등록:
1. GitHub 레포 → Settings → Webhooks → Add webhook
2. **Payload URL**: `https://134.185.103.92.nip.io/webhooks/deploy-bodam`
3. **Content type**: `application/json`
4. **Secret**: setup-webhook.sh에서 사용한 `YOUR_SECRET`
5. **Events**: "Just the push event"
6. Save

이후 main 브랜치에 push하면 자동으로 서버에서 deploy.sh가 실행됩니다.

---

## 운영 명령어

```bash
# 컨테이너 상태
docker compose -f docker-compose.prod.yml ps

# 로그 확인
docker compose -f docker-compose.prod.yml logs backend -f
docker compose -f docker-compose.prod.yml logs postgres -f

# 수동 재배포
bash /home/ubuntu/bodam/deploy/scripts/deploy.sh

# 롤백
bash /home/ubuntu/bodam/deploy/scripts/rollback.sh

# 메모리 상태 확인
free -h
```

---

## 메모리 구성 (1GB RAM + 2GB Swap)

| 서비스 | 메모리 제한 |
|--------|------------|
| postgres | 256MB |
| redis | 128MB |
| backend | 400MB |
| nginx | 256MB |
| **합계** | **~1040MB** |

RAM 부족 시 Swap(디스크)으로 보완됩니다. Swap은 RAM보다 느리므로 트래픽이 많아지면 더 큰 인스턴스 전환을 권장합니다.

---

## 문제 해결

### OOM (메모리 부족) 발생 시
```bash
# 현재 메모리/스왑 사용량 확인
free -h
# Swap이 꽉 찼다면 컨테이너 재시작
docker compose -f docker-compose.prod.yml restart
```

### SSL 인증서 만료 (90일마다 자동 갱신)
```bash
sudo certbot renew --dry-run  # 갱신 테스트
sudo certbot renew            # 실제 갱신
```

### 컨테이너 시작 실패
```bash
docker compose -f docker-compose.prod.yml logs --tail=50
```

### Nginx 502
```bash
docker compose -f docker-compose.prod.yml ps
sudo nginx -t
```
