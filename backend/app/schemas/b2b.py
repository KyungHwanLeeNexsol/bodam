"""B2B 도메인 Pydantic 스키마 (SPEC-B2B-001 Phase 1, Module 4)

조직 생성/응답/업데이트, 조직 멤버, B2B 회원가입 스키마 정의.
API Key 생성/응답 스키마 포함.
고객(AgentClient) 생성/응답/업데이트 및 동의 관리 스키마 포함 (Phase 3).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, field_validator

from app.core.sanitize import sanitize_input
from app.models.agent_client import ConsentStatus
from app.models.organization import OrgType, PlanType
from app.models.organization_member import OrgMemberRole


class OrganizationCreate(BaseModel):
    """조직 생성 요청 스키마"""

    # 조직명
    name: str
    # 사업자등록번호
    business_number: str
    # 조직 유형 (GA/INDEPENDENT/CORPORATE)
    org_type: OrgType
    # 요금제 유형
    plan_type: PlanType
    # 상위 조직 UUID (최상위 조직은 None)
    parent_org_id: uuid.UUID | None = None
    # 월간 API 호출 한도 (기본값: 1000)
    monthly_api_limit: int = 1000


class OrganizationResponse(BaseModel):
    """조직 정보 응답 스키마"""

    # 조직 UUID
    id: uuid.UUID
    # 조직명
    name: str
    # 사업자등록번호
    business_number: str
    # 조직 유형
    org_type: OrgType
    # 상위 조직 UUID (선택)
    parent_org_id: uuid.UUID | None = None
    # 요금제 유형
    plan_type: PlanType
    # 월간 API 호출 한도
    monthly_api_limit: int
    # 조직 활성 상태
    is_active: bool
    # 생성 일시
    created_at: datetime
    # 수정 일시
    updated_at: datetime

    model_config = {"from_attributes": True}


class OrganizationUpdate(BaseModel):
    """조직 정보 수정 요청 스키마 (부분 업데이트)"""

    # 조직명 (선택)
    name: str | None = None
    # 요금제 유형 (선택)
    plan_type: PlanType | None = None
    # 월간 API 호출 한도 (선택)
    monthly_api_limit: int | None = None
    # 조직 활성 상태 (선택)
    is_active: bool | None = None


class OrganizationMemberResponse(BaseModel):
    """조직 멤버 응답 스키마"""

    # 멤버 UUID
    id: uuid.UUID
    # 조직 UUID
    organization_id: uuid.UUID
    # 사용자 UUID
    user_id: uuid.UUID
    # 조직 내 역할
    role: OrgMemberRole
    # 멤버 활성 상태
    is_active: bool
    # 가입 일시
    joined_at: datetime

    model_config = {"from_attributes": True}


class OrganizationMemberInvite(BaseModel):
    """조직 멤버 초대 요청 스키마"""

    # 초대할 사용자 이메일
    email: EmailStr
    # 부여할 역할
    role: OrgMemberRole

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        """이메일을 소문자로 정규화"""
        return v.lower().strip()


class B2BRegistrationRequest(BaseModel):
    """B2B 회원가입 요청 스키마 (설계사 등록)

    RegisterRequest를 확장하여 사업자등록번호 및 조직 정보 포함.
    """

    # 이메일 (소문자로 정규화)
    email: EmailStr
    # 비밀번호 (평문, 서비스 레이어에서 해시 처리)
    password: str
    # 사용자 이름 (선택)
    full_name: str | None = None
    # 사업자등록번호 (필수)
    business_number: str
    # 조직명
    organization_name: str
    # 조직 유형
    org_type: OrgType

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        """이메일을 소문자로 정규화"""
        return v.lower().strip()

    @field_validator("full_name", mode="before")
    @classmethod
    def validate_full_name_no_xss(cls, v: str | None) -> str | None:
        """full_name에서 XSS 패턴을 검사한다"""
        return sanitize_input(v)


# ─────────────────────────────────────────────
# API Key 스키마 (SPEC-B2B-001 Module 4)
# ─────────────────────────────────────────────


class APIKeyCreate(BaseModel):
    """API 키 생성 요청 스키마 (AC-007)"""

    # 키 이름/설명
    name: str
    # 허용할 스코프 목록 (예: ["read", "write", "analysis", "admin"])
    scopes: list[str]


class APIKeyResponse(BaseModel):
    """API 키 응답 스키마 (마스킹된 키 정보만 포함)

    AC-007: 목록 조회 시 마스킹된 키만 표시 (key_hash 미포함)
    """

    # 키 UUID
    id: uuid.UUID
    # 키 접두사 (예: "bdk_")
    key_prefix: str
    # 마지막 4자리 (사용자 확인용)
    key_last4: str
    # 키 이름/설명
    name: str
    # 허용된 스코프 목록
    scopes: list[str]
    # 활성 상태
    is_active: bool
    # 마지막 사용 시각 (nullable)
    last_used_at: datetime | None = None
    # 생성 일시
    created_at: datetime

    model_config = {"from_attributes": True}


class APIKeyFullResponse(APIKeyResponse):
    """API 키 생성 응답 스키마 (전체 키 포함)

    AC-007: 생성 시 한 번만 full_key 반환
    이후 조회에서는 APIKeyResponse를 사용하여 마스킹된 정보만 제공
    """

    # 전체 API 키 (생성 시 한 번만 반환)
    # @MX:WARN: 이 값은 생성 응답에만 포함되며 DB에는 저장되지 않음
    # @MX:REASON: 보안 요구사항 - 전체 키는 한 번만 노출
    full_key: str


# ─────────────────────────────────────────────
# 고객(AgentClient) 스키마 (SPEC-B2B-001 Module 2 Phase 3)
# ─────────────────────────────────────────────


class ClientCreate(BaseModel):
    """고객 등록 요청 스키마 (AC-003)

    PII 필드는 서비스 레이어에서 암호화된 후 저장.
    """

    # 고객명 (서비스에서 암호화)
    client_name: str
    # 연락처 (서비스에서 암호화)
    client_phone: str
    # 이메일 (선택, 서비스에서 암호화)
    client_email: str | None = None


class ClientUpdate(BaseModel):
    """고객 정보 수정 요청 스키마 (부분 업데이트)

    변경된 PII 필드는 서비스 레이어에서 재암호화.
    """

    # 고객명 (선택)
    client_name: str | None = None
    # 연락처 (선택)
    client_phone: str | None = None
    # 이메일 (선택)
    client_email: str | None = None
    # 메모 (선택, 암호화 불필요)
    notes: str | None = None


class ClientResponse(BaseModel):
    """고객 정보 응답 스키마 (복호화된 PII 포함)"""

    # 고객 UUID
    id: uuid.UUID
    # 조직 UUID
    org_id: uuid.UUID
    # 담당 설계사 UUID
    agent_id: uuid.UUID
    # 고객명 (복호화된 값)
    client_name: str
    # 연락처 (복호화된 값)
    client_phone: str
    # 이메일 (복호화된 값, nullable)
    client_email: str | None = None
    # 동의 상태
    consent_status: ConsentStatus
    # 동의 일시 (nullable)
    consent_date: datetime | None = None
    # 메모
    notes: str | None = None
    # 생성 일시
    created_at: datetime
    # 수정 일시
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConsentUpdateRequest(BaseModel):
    """동의 상태 업데이트 요청 스키마"""

    # 변경할 동의 상태 (ACTIVE 또는 REVOKED)
    consent_status: ConsentStatus


class AnalyzeRequest(BaseModel):
    """고객 분석 요청 스키마 (AC-003: ACTIVE 동의 필요)"""

    # 분석 질의 텍스트
    query: str


class AnalysisHistoryResponse(BaseModel):
    """분석 이력 응답 스키마"""

    # 이력 UUID
    id: uuid.UUID
    # 분석 질의
    query: str
    # 분석 결과
    result: str
    # 분석 일시
    created_at: datetime

    model_config = {"from_attributes": True}


# ─────────────────────────────────────────────
# 사용량/과금 스키마 (SPEC-B2B-001 Phase 4)
# ─────────────────────────────────────────────


class UsageSummaryResponse(BaseModel):
    """사용량 요약 응답 스키마 (AC-009)"""

    # 전체 요청 수
    total_requests: int
    # 요금제 월간 한도
    plan_limit: int
    # 사용 비율 (%)
    usage_percentage: float
    # 엔드포인트별 요청 수 (엔드포인트 -> 요청 수)
    by_endpoint: dict
    # 에이전트별 요청 수 (에이전트 ID -> 요청 수)
    by_agent: dict = {}


class UsageRecordItem(BaseModel):
    """개별 사용량 기록 스키마"""

    # 기록 UUID
    id: uuid.UUID
    # 조직 UUID
    organization_id: uuid.UUID
    # API 키 UUID (선택)
    api_key_id: uuid.UUID | None = None
    # 사용자 UUID (선택)
    user_id: uuid.UUID | None = None
    # 엔드포인트
    endpoint: str
    # HTTP 메서드
    method: str
    # HTTP 응답 코드
    status_code: int
    # 소비된 토큰 수
    tokens_consumed: int
    # 응답 시간(밀리초)
    response_time_ms: int
    # 요청 IP
    ip_address: str
    # 기록 생성 일시
    created_at: datetime

    model_config = {"from_attributes": True}


class UsageDetailResponse(BaseModel):
    """상세 사용량 페이지네이션 응답 스키마"""

    # 사용량 기록 목록
    items: list[UsageRecordItem]
    # 전체 항목 수
    total: int
    # 현재 페이지 번호
    page: int
    # 페이지당 항목 수
    page_size: int


class UsageExportResponse(BaseModel):
    """사용량 CSV 내보내기 응답 스키마 (AC-010)"""

    # CSV 내용 문자열
    csv_content: str
    # 다운로드 파일명 (예: usage_2026-03.csv)
    filename: str


class BillingEstimateResponse(BaseModel):
    """현재 월 청구 예상 응답 스키마"""

    # 청구 기간 (YYYY-MM 형식)
    period: str
    # 현재 월 전체 요청 수
    total_requests: int
    # 요금제 월간 한도
    plan_limit: int
    # 사용 비율 (%)
    usage_percentage: float
    # 예상 청구 금액 (원, placeholder: 요청당 10원)
    estimated_cost: int


# ─────────────────────────────────────────────
# 대시보드 스키마 (SPEC-B2B-001 Phase 5)
# ─────────────────────────────────────────────


class AgentDashboardResponse(BaseModel):
    """설계사 대시보드 응답 스키마 (AC-005)"""

    # 담당 고객 수
    total_clients: int
    # 동의 완료 고객 수
    active_clients: int
    # 최근 분석 질의 이력 (최대 10건)
    recent_queries: list[dict]
    # 이번 달 API 호출 수
    monthly_activity: int


class AgentStatistic(BaseModel):
    """설계사별 통계 스키마"""

    # 설계사 UUID
    agent_id: uuid.UUID
    # 설계사 이름
    agent_name: str
    # 담당 고객 수
    client_count: int
    # 질의 수
    query_count: int


class UsageTrendItem(BaseModel):
    """월별 사용량 추이 항목 스키마"""

    # 기간 (YYYY-MM 형식)
    period: str
    # 요청 수
    request_count: int


class PlanInfo(BaseModel):
    """요금제 정보 스키마"""

    # 요금제 유형
    plan_type: str
    # 월간 한도
    monthly_limit: int
    # 현재 사용량
    current_usage: int
    # 사용 비율 (%)
    usage_percentage: float


class OrgDashboardResponse(BaseModel):
    """조직 대시보드 응답 스키마 (AC-006)"""

    # 소속 설계사 수
    total_agents: int
    # 전체 고객 수
    total_clients: int
    # 월별 API 호출 수
    monthly_api_calls: int
    # 설계사별 고객/질의 통계
    agent_statistics: list[AgentStatistic]
    # 최근 6개월 사용량 추이
    usage_trend: list[UsageTrendItem]
    # 현재 플랜 정보
    plan_info: PlanInfo
