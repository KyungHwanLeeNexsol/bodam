# 보담 OCI 배포 가이드

Oracle Cloud Infrastructure (OCI) Always Free 티어를 이용한 보담 서비스 배포 가이드입니다.

## 사양

- **인스턴스**: VM.Standard.A1.Flex (ARM64 Ampere)
- **CPU**: 4 OCPU (Always Free 최대)
- **RAM**: 24GB (Always Free 최대)
- **OS**: Ubuntu 22.04 aarch64
- **스토리지**: 200GB 부트 볼륨 (Always Free)

---

## 1단계: OCI 계정 및 VM 인스턴스 생성

### 계정 생성

1. [OCI 공식 사이트](https://www.oracle.com/cloud/free/) 접속
2. "Start for Free" 클릭 후 계정 생성
3. 신용카드 인증 필요 (Always Free 한도 내에서 과금 없음)
4. 홈 리전 선택 (가장 가까운 리전 권장 - 한국: ap-seoul-1)

### VM 인스턴스 생성

1. OCI 콘솔 접속 후 "Compute > Instances > Create Instance" 클릭
2. **이름**: bodam-server
3. **이미지**: Canonical Ubuntu 22.04 선택
4. **Shape**: VM.Standard.A1.Flex 선택
   - OCPU: 4
   - Memory: 24GB
5. **SSH 키**: 기존 키 업로드 또는 새 키 생성 (반드시 보관)
6. **부트 볼륨**: 200GB (Always Free 최대)
7. "Create" 클릭 후 인스턴스 생성 대기 (약 2-3분)

---

## 2단계: Security List 설정 (포트 개방)

인스턴스의 네트워크 보안 그룹에서 포트를 열어야 합니다.

1. OCI 콘솔에서 "Networking > Virtual Cloud Networks" 이동
2. 생성된 VCN 클릭
3. "Security Lists > Default Security List" 클릭
4. "Add Ingress Rules" 클릭하여 다음 규칙 추가:

| 소스 CIDR | 프로토콜 | 포트 | 설명 |
|-----------|---------|------|------|
| 0.0.0.0/0 | TCP | 22 | SSH |
| 0.0.0.0/0 | TCP | 80 | HTTP |
| 0.0.0.0/0 | TCP | 443 | HTTPS |

---

## 3단계: SSH로 서버 접속

```bash
# SSH 키 권한 설정 (처음 한 번만)
chmod 600 ~/.ssh/your-oci-key.pem

# 서버 접속
ssh -i ~/.ssh/your-oci-key.pem ubuntu@YOUR_SERVER_IP
```

**서버 IP 확인**: OCI 콘솔 > Compute > Instances > 인스턴스 클릭 > "Public IP Address"

---

## 4단계: setup.sh 실행

서버에 접속한 후 초기 설정 스크립트를 실행합니다.

```bash
# 코드 먼저 클론 (setup.sh를 실행하기 위해)
sudo apt-get update -y && sudo apt-get install -y git
git clone https://github.com/YOUR_ORG/bodam /opt/bodam

# 초기 설정 스크립트 실행
sudo bash /opt/bodam/deploy/oci/setup.sh
```

스크립트가 설치하는 항목:
- Docker Engine (ARM64 공식 패키지)
- Docker Compose v2 플러그인
- Nginx
- Certbot (Let's Encrypt SSL 인증서)
- UFW 방화벽 (22, 80, 443 포트 허용)

---

## 5단계: 코드 클론 확인

```bash
# setup.sh 실행 후 SSH 재접속 (docker 그룹 권한 적용)
exit
ssh -i ~/.ssh/your-oci-key.pem ubuntu@YOUR_SERVER_IP

# /opt/bodam 디렉토리 확인
ls /opt/bodam
```

---

## 6단계: .env.prod 파일 설정

```bash
# 백엔드 환경 변수 설정
cd /opt/bodam
cp backend/.env.prod.example backend/.env.prod
nano backend/.env.prod
```

변경 필수 항목:
- `POSTGRES_PASSWORD`: 강력한 비밀번호로 변경
- `SECRET_KEY`: `openssl rand -hex 32` 명령으로 생성
- `GEMINI_API_KEY`: Gemini API 키 입력
- `ALLOWED_ORIGINS`: 실제 도메인 입력

```bash
# 프론트엔드 환경 변수 설정
cp frontend/.env.prod.example frontend/.env.prod
nano frontend/.env.prod
```

변경 필수 항목:
- `NEXT_PUBLIC_API_URL`: 실제 도메인 입력 (예: https://bodam.example.com)

---

## 7단계: 도메인 없는 경우 nip.io 사용

도메인 없이도 HTTPS를 사용할 수 있습니다. nip.io는 IP를 도메인으로 변환해줍니다.

서버 IP가 `141.148.100.200`이라면:
- 도메인: `141.148.100.200.nip.io`
- HTTPS: `https://141.148.100.200.nip.io`

nip.io 사용 시 환경 변수:
```bash
NEXT_PUBLIC_API_URL=https://141.148.100.200.nip.io
ALLOWED_ORIGINS=https://141.148.100.200.nip.io
```

---

## 8단계: Nginx 설정 및 HTTPS 인증서 발급

```bash
# Nginx 설정 파일 복사
sudo cp /opt/bodam/deploy/nginx/bodam.conf /etc/nginx/sites-available/bodam
sudo ln -s /etc/nginx/sites-available/bodam /etc/nginx/sites-enabled/bodam

# 기본 Nginx 설정 비활성화 (포트 충돌 방지)
sudo rm -f /etc/nginx/sites-enabled/default

# server_name 수정 (실제 도메인 또는 nip.io 주소로)
sudo nano /etc/nginx/sites-available/bodam
# server_name _; 부분을 실제 도메인으로 변경
# 예: server_name 141.148.100.200.nip.io;

# Nginx 설정 검증 및 재시작
sudo nginx -t
sudo systemctl restart nginx

# Certbot으로 SSL 인증서 발급 (HTTP만 먼저 주석 처리된 상태로 실행)
# 주의: SSL 설정 블록은 인증서 발급 전 주석 처리 필요
sudo certbot --nginx -d your-domain.com

# 인증서 자동 갱신 크론잡 확인
sudo systemctl status certbot.timer
```

---

## 9단계: GitHub Actions Secrets 설정

GitHub 저장소 > Settings > Secrets and variables > Actions에서 다음 시크릿 추가:

| Secret 이름 | 값 |
|-------------|---|
| OCI_SSH_HOST | OCI 서버 Public IP |
| OCI_SSH_USER | ubuntu |
| OCI_SSH_KEY | SSH 개인키 내용 (-----BEGIN OPENSSH PRIVATE KEY----- 포함) |

SSH 개인키 내용 확인:
```bash
cat ~/.ssh/your-oci-key.pem
```

---

## 10단계: 첫 배포 실행

### 수동 배포 (처음 한 번)
```bash
# 서버에서 직접 실행
bash /opt/bodam/deploy/oci/deploy.sh
```

### GitHub Actions 자동 배포 확인
main 브랜치에 push하면 자동으로 배포됩니다.
GitHub 저장소 > Actions 탭에서 배포 진행 상황을 확인하세요.

---

## 운영 명령어

```bash
# 컨테이너 상태 확인
docker compose -f docker-compose.prod.yml ps

# 백엔드 로그 확인
docker compose -f docker-compose.prod.yml logs backend -f

# 프론트엔드 로그 확인
docker compose -f docker-compose.prod.yml logs frontend -f

# 모니터링 스택 시작
docker compose -f docker-compose.prod.yml --profile monitoring up -d

# 수동 재배포
bash /opt/bodam/deploy/oci/deploy.sh
```

---

## 문제 해결

### 컨테이너가 시작되지 않는 경우
```bash
docker compose -f docker-compose.prod.yml logs --tail=50
```

### 데이터베이스 연결 실패
```bash
# postgres 컨테이너 상태 확인
docker compose -f docker-compose.prod.yml exec postgres pg_isready -U bodam
```

### Nginx 502 오류
```bash
# 백엔드/프론트엔드 컨테이너가 실행 중인지 확인
docker compose -f docker-compose.prod.yml ps
sudo nginx -t
sudo systemctl status nginx
```
