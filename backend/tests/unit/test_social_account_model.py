"""SocialAccount 모델 단위 테스트 (TAG-001 RED)

SPEC-OAUTH-001: SocialAccount SQLAlchemy 모델 구조 검증.
ACC-11: social_accounts 테이블 생성 및 제약조건 확인.
"""

from __future__ import annotations

import uuid

import pytest
import sqlalchemy as sa

from app.models.social_account import SocialAccount


class TestSocialAccountModel:
    """SocialAccount 모델 구조 테스트"""

    def test_social_account_tablename(self):
        """테이블명이 social_accounts인지 확인"""
        assert SocialAccount.__tablename__ == "social_accounts"

    def test_social_account_has_id_column(self):
        """id 컬럼이 UUID PK인지 확인"""
        col = SocialAccount.__table__.c["id"]
        assert col.primary_key is True

    def test_social_account_has_user_id_column(self):
        """user_id 컬럼이 FK이고 NOT NULL인지 확인"""
        col = SocialAccount.__table__.c["user_id"]
        assert not col.nullable
        # FK 확인
        fk_targets = [fk.target_fullname for fk in col.foreign_keys]
        assert "users.id" in fk_targets

    def test_social_account_has_provider_column(self):
        """provider 컬럼이 VARCHAR(20) NOT NULL인지 확인"""
        col = SocialAccount.__table__.c["provider"]
        assert not col.nullable

    def test_social_account_has_provider_user_id_column(self):
        """provider_user_id 컬럼이 NOT NULL인지 확인"""
        col = SocialAccount.__table__.c["provider_user_id"]
        assert not col.nullable

    def test_social_account_has_provider_email_column(self):
        """provider_email 컬럼이 nullable인지 확인"""
        col = SocialAccount.__table__.c["provider_email"]
        assert col.nullable

    def test_social_account_has_provider_name_column(self):
        """provider_name 컬럼이 nullable인지 확인"""
        col = SocialAccount.__table__.c["provider_name"]
        assert col.nullable

    def test_social_account_has_access_token_column(self):
        """access_token 컬럼이 nullable TEXT인지 확인"""
        col = SocialAccount.__table__.c["access_token"]
        assert col.nullable

    def test_social_account_has_timestamp_columns(self):
        """created_at, updated_at 컬럼이 존재하는지 확인"""
        cols = {c.name for c in SocialAccount.__table__.c}
        assert "created_at" in cols
        assert "updated_at" in cols

    def test_social_account_unique_constraint(self):
        """(provider, provider_user_id) UNIQUE 제약조건 존재 확인"""
        table = SocialAccount.__table__
        unique_constraints = {
            frozenset(c.name for c in uc.columns)
            for uc in table.constraints
            if isinstance(uc, sa.UniqueConstraint)
        }
        assert frozenset(["provider", "provider_user_id"]) in unique_constraints

    def test_social_account_instantiation(self):
        """SocialAccount 인스턴스 생성 가능 확인"""
        account = SocialAccount(
            user_id=uuid.uuid4(),
            provider="kakao",
            provider_user_id="12345678",
            provider_email="test@kakao.com",
            provider_name="테스트유저",
        )
        assert account.provider == "kakao"
        assert account.provider_user_id == "12345678"
        assert account.provider_email == "test@kakao.com"

    def test_social_account_repr(self):
        """__repr__ 메서드가 정의되어 있는지 확인"""
        account = SocialAccount(
            user_id=uuid.uuid4(),
            provider="naver",
            provider_user_id="naver_001",
        )
        repr_str = repr(account)
        assert "SocialAccount" in repr_str

    def test_social_account_provider_naver(self):
        """네이버 프로바이더로 인스턴스 생성"""
        account = SocialAccount(
            user_id=uuid.uuid4(),
            provider="naver",
            provider_user_id="naver_user_001",
        )
        assert account.provider == "naver"

    def test_social_account_provider_google(self):
        """구글 프로바이더로 인스턴스 생성"""
        account = SocialAccount(
            user_id=uuid.uuid4(),
            provider="google",
            provider_user_id="google_user_001",
            provider_email="user@gmail.com",
        )
        assert account.provider == "google"
        assert account.provider_email == "user@gmail.com"
