"""크롤러 스토리지 단위 테스트 (SPEC-CRAWLER-001)

LocalFileStorage, StorageBackend ABC, 팩토리 함수 테스트.
tmp_path 픽스처로 실제 파일 시스템 사용.
"""

from __future__ import annotations

import pytest

from app.services.crawler.storage import LocalFileStorage, StorageBackend, create_storage


class TestStorageBackend:
    """StorageBackend ABC 테스트"""

    def test_storage_backend_is_abstract(self):
        """StorageBackend는 추상 클래스여야 함"""
        from abc import ABC

        assert issubclass(StorageBackend, ABC)

    def test_storage_backend_cannot_be_instantiated(self):
        """StorageBackend는 직접 인스턴스화할 수 없어야 함"""
        with pytest.raises(TypeError):
            StorageBackend()  # type: ignore


class TestLocalFileStorage:
    """LocalFileStorage 테스트"""

    def test_local_storage_creation(self, tmp_path):
        """LocalFileStorage 인스턴스 생성"""
        storage = LocalFileStorage(base_dir=str(tmp_path))
        assert storage is not None

    def test_save_creates_file(self, tmp_path):
        """save()는 파일을 생성해야 함"""
        storage = LocalFileStorage(base_dir=str(tmp_path))
        data = b"pdf content"
        path = "test_company/test_product/v1.pdf"

        storage.save(data, path)

        full_path = tmp_path / path
        assert full_path.exists()
        assert full_path.read_bytes() == data

    def test_save_creates_parent_directories(self, tmp_path):
        """save()는 부모 디렉토리를 자동 생성해야 함"""
        storage = LocalFileStorage(base_dir=str(tmp_path))
        data = b"content"
        path = "deep/nested/dir/file.pdf"

        storage.save(data, path)

        assert (tmp_path / path).exists()

    def test_exists_returns_true_for_existing_file(self, tmp_path):
        """exists()는 파일이 존재하면 True를 반환해야 함"""
        storage = LocalFileStorage(base_dir=str(tmp_path))
        path = "existing.pdf"
        (tmp_path / path).write_bytes(b"content")

        assert storage.exists(path) is True

    def test_exists_returns_false_for_missing_file(self, tmp_path):
        """exists()는 파일이 없으면 False를 반환해야 함"""
        storage = LocalFileStorage(base_dir=str(tmp_path))

        assert storage.exists("nonexistent.pdf") is False

    def test_get_path_returns_structured_path(self, tmp_path):
        """get_path()는 구조화된 경로를 반환해야 함"""
        storage = LocalFileStorage(base_dir=str(tmp_path))
        path = storage.get_path(
            company_code="samsung-life",
            product_code="SL-001",
            version="20240101",
        )

        # 회사 코드, 상품 코드, 버전이 경로에 포함되어야 함
        assert "samsung-life" in path
        assert "SL-001" in path
        assert "20240101" in path

    def test_delete_removes_file(self, tmp_path):
        """delete()는 파일을 삭제해야 함"""
        storage = LocalFileStorage(base_dir=str(tmp_path))
        path = "to_delete.pdf"
        (tmp_path / path).write_bytes(b"content")

        storage.delete(path)

        assert not (tmp_path / path).exists()

    def test_delete_nonexistent_file_no_error(self, tmp_path):
        """delete()는 없는 파일 삭제 시 오류가 없어야 함"""
        storage = LocalFileStorage(base_dir=str(tmp_path))

        # 예외 없이 실행되어야 함
        storage.delete("nonexistent.pdf")


class TestCreateStorage:
    """create_storage 팩토리 함수 테스트"""

    def test_create_local_storage(self, tmp_path):
        """'local' 타입으로 LocalFileStorage 생성"""
        storage = create_storage("local", base_dir=str(tmp_path))
        assert isinstance(storage, LocalFileStorage)

    def test_create_storage_unknown_type_raises(self, tmp_path):
        """알 수 없는 타입은 ValueError를 발생시켜야 함"""
        with pytest.raises(ValueError, match="지원하지 않는"):
            create_storage("unknown_backend", base_dir=str(tmp_path))

    def test_create_s3_storage_returns_instance(self, tmp_path):
        """'s3' 타입은 S3Storage 인스턴스를 반환해야 함"""
        from app.services.crawler.storage import S3Storage

        storage = create_storage("s3", base_dir=str(tmp_path))
        assert isinstance(storage, S3Storage)
