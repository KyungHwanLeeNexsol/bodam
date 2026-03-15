"""OAuthService 단위 테스트 (TAG-007 RED)

SPEC-OAUTH-001:
- ACC-11: 소셜 계정 연결
- ACC-12: 소셜 계정 해제
- ACC-13: 마지막 인증 수단 삭제 방지
- ACC-14: 소셜 계정 목록 API
- ACC-17: 계정 병합
- ACC-18: 자동 병합 금지 (409 반환)
- ACC-19: 신규 사용자 자동 생성
- ACC-22: CSRF state 검증
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas.oauth import OAuthUserInfo

# ─────────────────────────────────────────────
# 픽스처
# ─────────────────────────────────────────────

@pytest.fixture
def mock_db():
    """비동기 DB 세션 모의 객체"""
    db = AsyncMock()
    return db


@pytest.fixture
def mock_redis():
    """Redis 클라이언트 모의 객체"""
    redis = AsyncMock()
    return redis


@pytest.fixture
def mock_settings():
    """테스트용 Settings 모의 객체"""
    settings = MagicMock()
    settings.secret_key = "test-secret-key-for-testing-purposes-only"
    settings.jwt_algorithm = "HS256"
    settings.access_token_expire_minutes = 30
    settings.social_token_encryption_key = ""
    return settings


@pytest.fixture
def oauth_service(mock_db, mock_redis, mock_settings):
    """OAuthService 인스턴스"""
    from app.services.oauth_service import OAuthService
    return OAuthService(db=mock_db, redis=mock_redis, settings=mock_settings)


@pytest.fixture
def sample_user_info():
    """카카오 사용자 정보 샘플"""
    return OAuthUserInfo(
        provider="kakao",
        provider_user_id="12345678",
        email="user@kakao.com",
        name="카카오유저",
    )


@pytest.fixture
def sample_user_info_no_email():
    """이메일 없는 카카오 사용자 정보 샘플"""
    return OAuthUserInfo(
        provider="kakao",
        provider_user_id="87654321",
        email=None,
        name="이메일미동의",
    )


# ─────────────────────────────────────────────
# State 관리 테스트 (ACC-22)
# ─────────────────────────────────────────────

class TestOAuthServiceState:
    """CSRF state 생성/검증 테스트"""

    async def test_generate_state_returns_string(self, oauth_service, mock_redis):
        """generate_state가 문자열 반환 (ACC-22)"""
        mock_redis.setex = AsyncMock(return_value=True)
        state = await oauth_service.generate_state()
        assert isinstance(state, str)
        assert len(state) >= 16

    async def test_generate_state_stores_in_redis(self, oauth_service, mock_redis):
        """generate_state가 Redis에 저장 (TTL 5분)"""
        mock_redis.setex = AsyncMock(return_value=True)
        state = await oauth_service.generate_state()
        mock_redis.setex.assert_called_once()
        # TTL이 300초(5분)인지 확인
        call_args = mock_redis.setex.call_args
        assert 300 in call_args.args or call_args.kwargs.get("time") == 300

    async def test_validate_state_returns_true_for_valid(self, oauth_service, mock_redis):
        """Redis에 있는 state 검증 성공 (ACC-22)"""
        mock_redis.get = AsyncMock(return_value=b"1")
        mock_redis.delete = AsyncMock(return_value=1)
        result = await oauth_service.validate_state("valid_state")
        assert result is True

    async def test_validate_state_returns_false_for_invalid(self, oauth_service, mock_redis):
        """Redis에 없는 state 검증 실패"""
        mock_redis.get = AsyncMock(return_value=None)
        result = await oauth_service.validate_state("invalid_state")
        assert result is False

    async def test_validate_state_deletes_after_use(self, oauth_service, mock_redis):
        """state 검증 후 Redis에서 삭제 (일회용)"""
        mock_redis.get = AsyncMock(return_value=b"1")
        mock_redis.delete = AsyncMock(return_value=1)
        await oauth_service.validate_state("used_state")
        mock_redis.delete.assert_called_once()


# ─────────────────────────────────────────────
# 사용자 조회/생성 테스트 (ACC-17~19)
# ─────────────────────────────────────────────

class TestOAuthServiceGetOrCreateUser:
    """get_or_create_user 비즈니스 로직 테스트"""

    async def test_existing_social_account_returns_jwt(
        self, oauth_service, mock_db, sample_user_info
    ):
        """기존 소셜 계정으로 로그인 시 JWT 반환 (ACC-11)"""
        from app.models.social_account import SocialAccount
        from app.models.user import User

        # 기존 소셜 계정 존재
        mock_social = MagicMock(spec=SocialAccount)
        mock_social.user_id = uuid.uuid4()

        mock_user = MagicMock(spec=User)
        mock_user.id = mock_social.user_id
        mock_user.is_active = True

        # DB 조회 결과 모의
        mock_result_social = MagicMock()
        mock_result_social.scalar_one_or_none.return_value = mock_social

        mock_result_user = MagicMock()
        mock_result_user.scalar_one_or_none.return_value = mock_user

        mock_db.execute = AsyncMock(side_effect=[mock_result_social, mock_result_user])

        result = await oauth_service.get_or_create_user(sample_user_info)

        assert "access_token" in result
        assert result["is_new_user"] is False

    async def test_email_conflict_returns_409(
        self, oauth_service, mock_db, sample_user_info
    ):
        """이메일이 이미 존재하는 경우 409 반환 (ACC-18, 자동 병합 금지)"""
        from fastapi import HTTPException

        from app.models.user import User

        # 소셜 계정 없음
        mock_result_social = MagicMock()
        mock_result_social.scalar_one_or_none.return_value = None

        # 이메일로 기존 계정 존재
        mock_user = MagicMock(spec=User)
        mock_user.id = uuid.uuid4()
        mock_result_email = MagicMock()
        mock_result_email.scalar_one_or_none.return_value = mock_user

        mock_db.execute = AsyncMock(side_effect=[mock_result_social, mock_result_email])
        mock_db.setex = AsyncMock(return_value=True)

        # Redis에 병합 토큰 저장
        with patch.object(oauth_service, "_store_merge_token", AsyncMock(return_value="merge_token_xyz")):
            with pytest.raises(HTTPException) as exc_info:
                await oauth_service.get_or_create_user(sample_user_info)

        assert exc_info.value.status_code == 409

    async def test_new_user_created_for_unknown_social(
        self, oauth_service, mock_db, sample_user_info
    ):
        """소셜 계정/이메일 모두 없으면 신규 User 생성 (ACC-19)"""
        # 소셜 계정 없음
        mock_result_social = MagicMock()
        mock_result_social.scalar_one_or_none.return_value = None

        # 이메일로도 없음
        mock_result_email = MagicMock()
        mock_result_email.scalar_one_or_none.return_value = None

        mock_db.execute = AsyncMock(side_effect=[mock_result_social, mock_result_email])
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock()

        # 신규 생성된 User의 id 설정을 위한 모의
        created_user_id = uuid.uuid4()

        async def mock_flush():
            # flush 후 user.id 설정 시뮬레이션은 side_effect로 처리
            pass

        mock_db.flush = AsyncMock(side_effect=mock_flush)

        # 실제 User 객체가 생성되므로 add() 호출 시 id를 직접 설정
        original_add = mock_db.add

        added_objects = []

        def capture_add(obj):
            added_objects.append(obj)
            if hasattr(obj, "id") and obj.id is None:
                obj.id = created_user_id

        mock_db.add = MagicMock(side_effect=capture_add)

        result = await oauth_service.get_or_create_user(sample_user_info)

        assert result["is_new_user"] is True
        assert "access_token" in result

    async def test_new_user_created_without_email(
        self, oauth_service, mock_db, sample_user_info_no_email
    ):
        """이메일 없는 소셜 사용자도 신규 생성 가능 (ACC-03)"""
        # 소셜 계정 없음 (이메일 없으므로 이메일 조회 스킵)
        mock_result_social = MagicMock()
        mock_result_social.scalar_one_or_none.return_value = None

        mock_db.execute = AsyncMock(return_value=mock_result_social)
        mock_db.add = MagicMock()

        created_user_id = uuid.uuid4()

        def capture_add(obj):
            if hasattr(obj, "id") and obj.id is None:
                obj.id = created_user_id

        mock_db.add = MagicMock(side_effect=capture_add)
        mock_db.flush = AsyncMock()

        result = await oauth_service.get_or_create_user(sample_user_info_no_email)
        assert result["is_new_user"] is True


# ─────────────────────────────────────────────
# 소셜 계정 목록/해제 테스트 (ACC-12~14)
# ─────────────────────────────────────────────

class TestOAuthServiceSocialAccounts:
    """소셜 계정 관리 테스트"""

    async def test_get_social_accounts_returns_list(self, oauth_service, mock_db):
        """소셜 계정 목록 조회 (ACC-14)"""
        from app.models.social_account import SocialAccount

        mock_account = MagicMock(spec=SocialAccount)
        mock_account.provider = "kakao"
        mock_account.provider_email = "user@kakao.com"
        mock_account.created_at = MagicMock()

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [mock_account]
        mock_db.execute = AsyncMock(return_value=mock_result)

        user_id = uuid.uuid4()
        accounts = await oauth_service.get_social_accounts(user_id)
        assert len(accounts) == 1

    async def test_unlink_last_social_account_raises_error(self, oauth_service, mock_db):
        """마지막 인증 수단 삭제 방지 (ACC-13)"""
        from fastapi import HTTPException

        from app.models.social_account import SocialAccount

        # 소셜 계정 1개만 존재하고 비밀번호 없음
        mock_account = MagicMock(spec=SocialAccount)
        mock_account.provider = "kakao"

        mock_result_accounts = MagicMock()
        mock_result_accounts.scalars.return_value.all.return_value = [mock_account]

        # 비밀번호 없는 사용자
        from app.models.user import User
        mock_user = MagicMock(spec=User)
        mock_user.hashed_password = None

        mock_result_user = MagicMock()
        mock_result_user.scalar_one_or_none.return_value = mock_user

        # 해당 provider 소셜 계정 조회 결과 (단건)
        mock_result_single_account = MagicMock()
        mock_result_single_account.scalar_one_or_none.return_value = mock_account

        # unlink_social_account: 1) _get_user_by_id, 2) 해당 provider 소셜 계정 조회, 3) get_social_accounts
        mock_db.execute = AsyncMock(side_effect=[mock_result_user, mock_result_single_account, mock_result_accounts])

        user_id = uuid.uuid4()
        with pytest.raises(HTTPException) as exc_info:
            await oauth_service.unlink_social_account(user_id, "kakao")

        assert exc_info.value.status_code == 400

    async def test_unlink_social_account_succeeds_when_password_exists(
        self, oauth_service, mock_db
    ):
        """비밀번호가 있는 사용자는 소셜 계정 해제 가능 (ACC-12)"""
        from app.models.social_account import SocialAccount
        from app.models.user import User

        # 비밀번호 있는 사용자
        mock_user = MagicMock(spec=User)
        mock_user.hashed_password = "$2b$12$hashedpassword"

        mock_result_user = MagicMock()
        mock_result_user.scalar_one_or_none.return_value = mock_user

        # 카카오 계정 존재
        mock_account = MagicMock(spec=SocialAccount)
        mock_account.provider = "kakao"

        mock_result_account = MagicMock()
        mock_result_account.scalar_one_or_none.return_value = mock_account

        mock_db.execute = AsyncMock(side_effect=[mock_result_user, mock_result_account])
        mock_db.delete = AsyncMock()
        mock_db.flush = AsyncMock()

        user_id = uuid.uuid4()
        # 예외 없이 실행 가능해야 함
        await oauth_service.unlink_social_account(user_id, "kakao")
        mock_db.delete.assert_called_once_with(mock_account)


# ─────────────────────────────────────────────
# 토큰 암호화/복호화 테스트 (ACC-22)
# ─────────────────────────────────────────────

class TestOAuthServiceEncryption:
    """토큰 암호화 테스트"""

    def test_encrypt_decrypt_roundtrip(self, oauth_service):
        """암호화 후 복호화하면 원본 복원 (암호화 키 없으면 그냥 반환)"""
        original = "access_token_plaintext"
        encrypted = oauth_service.encrypt_token(original)
        decrypted = oauth_service.decrypt_token(encrypted)
        assert decrypted == original

    def test_encrypt_with_key_produces_different_value(self, mock_db, mock_redis):
        """암호화 키가 있으면 다른 값 생성"""
        from cryptography.fernet import Fernet

        from app.services.oauth_service import OAuthService

        settings = MagicMock()
        settings.secret_key = "test-secret"
        settings.jwt_algorithm = "HS256"
        settings.access_token_expire_minutes = 30
        # 유효한 Fernet 키 생성
        settings.social_token_encryption_key = Fernet.generate_key().decode()

        service = OAuthService(db=mock_db, redis=mock_redis, settings=settings)

        original = "my_secret_token"
        encrypted = service.encrypt_token(original)
        assert encrypted != original

        decrypted = service.decrypt_token(encrypted)
        assert decrypted == original
