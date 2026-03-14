"""Celery 임베딩 태스크 단위 테스트 (SPEC-EMBED-001 TASK-009, TASK-010)

bulk_embed_policies() Celery 태스크의 Redis 진행률 추적,
중복 작업 방지, 비동기-동기 브릿지를 테스트.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch


class TestBulkEmbedPoliciesTask:
    """bulk_embed_policies() 태스크 테스트"""

    def test_task_is_importable(self):
        """태스크 모듈이 임포트 가능해야 한다"""
        from app.tasks.embedding_tasks import bulk_embed_policies

        assert callable(bulk_embed_policies)

    def test_task_is_celery_task(self):
        """bulk_embed_policies가 Celery 태스크여야 한다"""
        from app.tasks.embedding_tasks import bulk_embed_policies

        # Celery 태스크는 delay() 메서드를 가짐
        assert hasattr(bulk_embed_policies, "delay")
        assert hasattr(bulk_embed_policies, "apply_async")

    def test_task_accepts_policy_ids_and_force(self):
        """태스크가 policy_ids와 force 파라미터를 받아야 한다"""
        import inspect

        from app.tasks.embedding_tasks import bulk_embed_policies

        # 실제 함수 시그니처 확인
        # Celery 태스크는 run() 메서드에 실제 함수 래핑
        sig = inspect.signature(bulk_embed_policies.run)
        params = list(sig.parameters.keys())

        assert "policy_ids" in params
        assert "force" in params


class TestDuplicateTaskPrevention:
    """중복 작업 방지 테스트 (TASK-010)"""

    def test_duplicate_policy_embedding_is_rejected(self):
        """이미 처리 중인 정책의 임베딩 요청은 거부되어야 한다"""
        from app.tasks.embedding_tasks import is_policy_embedding_in_progress

        policy_id = str(uuid.uuid4())

        # Redis mock 설정: 락이 이미 존재하는 상황
        mock_redis = MagicMock()
        mock_redis.set = MagicMock(return_value=False)  # NX=True 실패 = 이미 존재

        result = is_policy_embedding_in_progress(policy_id, mock_redis)

        assert result is True, "이미 처리 중인 정책은 True를 반환해야 함"

    def test_new_policy_embedding_is_allowed(self):
        """처음 요청되는 정책의 임베딩은 허용되어야 한다"""
        from app.tasks.embedding_tasks import is_policy_embedding_in_progress

        policy_id = str(uuid.uuid4())

        # Redis mock 설정: 락이 없는 상황
        mock_redis = MagicMock()
        mock_redis.set = MagicMock(return_value=True)  # NX=True 성공 = 새로 설정됨

        result = is_policy_embedding_in_progress(policy_id, mock_redis)

        assert result is False, "새 정책은 False를 반환해야 함"

    def test_lock_key_format_includes_policy_id(self):
        """락 키가 정책 ID를 포함해야 한다"""
        from app.tasks.embedding_tasks import get_policy_lock_key

        policy_id = "test-policy-123"
        key = get_policy_lock_key(policy_id)

        assert policy_id in key
        assert "embed" in key.lower() or "lock" in key.lower()


class TestTaskProgressTracking:
    """작업 진행률 Redis 추적 테스트"""

    def test_progress_key_format(self):
        """Redis 진행률 키가 올바른 형식이어야 한다"""
        from app.tasks.embedding_tasks import get_task_progress_key

        task_id = "test-task-id-123"
        key = get_task_progress_key(task_id)

        assert task_id in key
        assert "embed_task" in key

    def test_initial_progress_structure(self):
        """초기 진행률 구조가 올바른 필드를 가져야 한다"""
        from app.tasks.embedding_tasks import create_initial_progress

        total = 5
        progress = create_initial_progress(total)

        assert "status" in progress
        assert "total" in progress
        assert "completed" in progress
        assert "failed" in progress
        assert progress["total"] == total
        assert progress["completed"] == 0
        assert progress["failed"] == 0
