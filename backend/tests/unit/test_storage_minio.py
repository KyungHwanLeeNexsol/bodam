"""S3Storage MinIO 호환 테스트 (SPEC-CRAWLER-002)

moto 라이브러리로 S3 API를 목킹하여 MinIO 호환 S3Storage를 테스트.
실제 MinIO 서버 없이 단위 테스트 가능.
"""

from __future__ import annotations

import os

import boto3
import pytest
from moto import mock_aws

from app.services.crawler.storage import S3Storage, LocalFileStorage, get_storage_backend


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def aws_credentials():
    """moto용 가짜 AWS 자격증명 설정"""
    os.environ["AWS_ACCESS_KEY_ID"] = "testing"
    os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
    os.environ["AWS_SECURITY_TOKEN"] = "testing"
    os.environ["AWS_SESSION_TOKEN"] = "testing"
    os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
    yield
    # 정리
    for key in ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SECURITY_TOKEN",
                "AWS_SESSION_TOKEN", "AWS_DEFAULT_REGION"]:
        os.environ.pop(key, None)


@pytest.fixture
def s3_bucket(aws_credentials):
    """moto로 S3 버킷 생성 후 반환"""
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket="test-bodam-pdfs")
        yield "test-bodam-pdfs"


@pytest.fixture
def s3_storage(s3_bucket):
    """테스트용 S3Storage 인스턴스 (moto 버킷 사용)"""
    # moto 컨텍스트 안에서 생성
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=s3_bucket)
        storage = S3Storage(
            bucket=s3_bucket,
            endpoint_url=None,  # moto는 endpoint_url 불필요
            access_key="testing",
            secret_key="testing",
            base_dir="",
        )
        yield storage


# ---------------------------------------------------------------------------
# S3Storage 생성자 테스트
# ---------------------------------------------------------------------------


class TestS3StorageConstructor:
    """S3Storage 생성자 파라미터 검증"""

    def test_constructor_accepts_minio_params(self):
        """MinIO 호환 파라미터로 생성자 호출 성공"""
        storage = S3Storage(
            bucket="bodam-pdfs",
            endpoint_url="http://localhost:9000",
            access_key="bodam",
            secret_key="bodam_minio_secret",
            base_dir="",
        )
        assert storage.bucket == "bodam-pdfs"
        assert storage.endpoint_url == "http://localhost:9000"

    def test_constructor_with_base_dir(self):
        """base_dir 설정 시 경로 접두사로 사용"""
        storage = S3Storage(
            bucket="bucket",
            endpoint_url="http://minio:9000",
            access_key="key",
            secret_key="secret",
            base_dir="pdfs",
        )
        assert storage.base_dir == "pdfs"

    def test_constructor_without_endpoint_url(self):
        """endpoint_url 없이 생성 (AWS S3 표준 모드)"""
        storage = S3Storage(
            bucket="bucket",
            endpoint_url=None,
            access_key="key",
            secret_key="secret",
            base_dir="",
        )
        assert storage.endpoint_url is None


# ---------------------------------------------------------------------------
# save() 메서드 테스트
# ---------------------------------------------------------------------------


class TestS3StorageSave:
    """S3Storage.save() 메서드 테스트"""

    @mock_aws()
    def test_save_returns_s3_key(self, aws_credentials):
        """save()는 업로드한 S3 키(경로) 문자열을 반환해야 함"""
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="bucket")
        storage = S3Storage(
            bucket="bucket",
            endpoint_url=None,
            access_key="testing",
            secret_key="testing",
            base_dir="",
        )
        result = storage.save(b"pdf content", "test/file.pdf")
        assert isinstance(result, str)
        assert "test/file.pdf" in result

    @mock_aws()
    def test_save_with_base_dir_prefix(self, aws_credentials):
        """base_dir가 있으면 S3 키에 접두사로 포함"""
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="bucket")
        storage = S3Storage(
            bucket="bucket",
            endpoint_url=None,
            access_key="testing",
            secret_key="testing",
            base_dir="prefix",
        )
        result = storage.save(b"data", "file.pdf")
        assert result == "prefix/file.pdf"

    @mock_aws()
    def test_save_without_base_dir(self, aws_credentials):
        """base_dir가 빈 문자열이면 경로만 사용"""
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="bucket")
        storage = S3Storage(
            bucket="bucket",
            endpoint_url=None,
            access_key="testing",
            secret_key="testing",
            base_dir="",
        )
        result = storage.save(b"data", "path/file.pdf")
        assert result == "path/file.pdf"

    @mock_aws()
    def test_save_uploads_correct_content(self, aws_credentials):
        """업로드된 파일 내용이 원본 데이터와 일치해야 함"""
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket="bucket")
        storage = S3Storage(
            bucket="bucket",
            endpoint_url=None,
            access_key="testing",
            secret_key="testing",
            base_dir="",
        )
        pdf_data = b"%PDF-1.4 test content"
        storage.save(pdf_data, "company/product/v1.pdf")

        response = client.get_object(Bucket="bucket", Key="company/product/v1.pdf")
        assert response["Body"].read() == pdf_data


# ---------------------------------------------------------------------------
# exists() 메서드 테스트
# ---------------------------------------------------------------------------


class TestS3StorageExists:
    """S3Storage.exists() 메서드 테스트"""

    @mock_aws()
    def test_exists_returns_true_for_uploaded_file(self, aws_credentials):
        """업로드한 파일에 대해 exists()는 True를 반환"""
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket="bucket")
        client.put_object(Bucket="bucket", Key="test.pdf", Body=b"data")

        storage = S3Storage(
            bucket="bucket",
            endpoint_url=None,
            access_key="testing",
            secret_key="testing",
            base_dir="",
        )
        assert storage.exists("test.pdf") is True

    @mock_aws()
    def test_exists_returns_false_for_missing_file(self, aws_credentials):
        """존재하지 않는 파일에 대해 exists()는 False를 반환"""
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="bucket")
        storage = S3Storage(
            bucket="bucket",
            endpoint_url=None,
            access_key="testing",
            secret_key="testing",
            base_dir="",
        )
        assert storage.exists("nonexistent.pdf") is False

    @mock_aws()
    def test_exists_with_base_dir_prefix(self, aws_credentials):
        """base_dir 접두사가 적용된 키로 존재 여부 확인"""
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket="bucket")
        client.put_object(Bucket="bucket", Key="prefix/file.pdf", Body=b"data")

        storage = S3Storage(
            bucket="bucket",
            endpoint_url=None,
            access_key="testing",
            secret_key="testing",
            base_dir="prefix",
        )
        assert storage.exists("file.pdf") is True


# ---------------------------------------------------------------------------
# delete() 메서드 테스트
# ---------------------------------------------------------------------------


class TestS3StorageDelete:
    """S3Storage.delete() 메서드 테스트"""

    @mock_aws()
    def test_delete_removes_file(self, aws_credentials):
        """delete() 후 파일이 존재하지 않아야 함"""
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket="bucket")
        client.put_object(Bucket="bucket", Key="file.pdf", Body=b"data")

        storage = S3Storage(
            bucket="bucket",
            endpoint_url=None,
            access_key="testing",
            secret_key="testing",
            base_dir="",
        )
        storage.delete("file.pdf")
        assert storage.exists("file.pdf") is False

    @mock_aws()
    def test_delete_nonexistent_file_no_error(self, aws_credentials):
        """존재하지 않는 파일 삭제 시 예외 없이 통과"""
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="bucket")
        storage = S3Storage(
            bucket="bucket",
            endpoint_url=None,
            access_key="testing",
            secret_key="testing",
            base_dir="",
        )
        # 예외 없이 통과해야 함
        storage.delete("nonexistent.pdf")


# ---------------------------------------------------------------------------
# get_path() 메서드 테스트
# ---------------------------------------------------------------------------


class TestS3StorageGetPath:
    """S3Storage.get_path() 메서드 테스트"""

    def test_get_path_returns_structured_path(self):
        """get_path()는 보험사/상품/파일명 형식의 경로를 반환"""
        storage = S3Storage(
            bucket="bucket",
            endpoint_url=None,
            access_key="key",
            secret_key="secret",
            base_dir="",
        )
        path = storage.get_path("heungkuk-life", "HL-001", "terms_v1.pdf")
        assert path == "heungkuk-life/HL-001/terms_v1.pdf"

    def test_get_path_signature_accepts_filename(self):
        """get_path() 세 번째 인자가 version이 아닌 filename 허용"""
        storage = S3Storage(
            bucket="bucket",
            endpoint_url=None,
            access_key="key",
            secret_key="secret",
            base_dir="",
        )
        path = storage.get_path("samsung-life", "SL-002", "약관_2024.pdf")
        assert "samsung-life" in path
        assert "SL-002" in path
        assert "약관_2024.pdf" in path


# ---------------------------------------------------------------------------
# get_storage_backend() 팩토리 함수 테스트
# ---------------------------------------------------------------------------


class TestGetStorageBackend:
    """get_storage_backend() 환경변수 기반 팩토리 함수 테스트"""

    def test_default_returns_local_storage(self, monkeypatch):
        """STORAGE_BACKEND 미설정 시 LocalFileStorage 반환"""
        monkeypatch.delenv("STORAGE_BACKEND", raising=False)
        monkeypatch.setenv("PDF_STORAGE_PATH", "/tmp/test_pdfs")

        backend = get_storage_backend()
        assert isinstance(backend, LocalFileStorage)

    def test_local_backend_returns_local_storage(self, monkeypatch):
        """STORAGE_BACKEND=local 시 LocalFileStorage 반환"""
        monkeypatch.setenv("STORAGE_BACKEND", "local")
        monkeypatch.setenv("PDF_STORAGE_PATH", "/tmp/test_pdfs")

        backend = get_storage_backend()
        assert isinstance(backend, LocalFileStorage)

    def test_s3_backend_returns_s3_storage(self, monkeypatch):
        """STORAGE_BACKEND=s3 시 S3Storage 반환"""
        monkeypatch.setenv("STORAGE_BACKEND", "s3")
        monkeypatch.setenv("MINIO_BUCKET", "bodam-pdfs")
        monkeypatch.setenv("MINIO_ENDPOINT", "http://localhost:9000")
        monkeypatch.setenv("MINIO_ACCESS_KEY", "bodam")
        monkeypatch.setenv("MINIO_SECRET_KEY", "bodam_secret")

        backend = get_storage_backend()
        assert isinstance(backend, S3Storage)

    def test_s3_backend_uses_env_vars(self, monkeypatch):
        """S3Storage는 환경변수 값을 그대로 사용"""
        monkeypatch.setenv("STORAGE_BACKEND", "s3")
        monkeypatch.setenv("MINIO_BUCKET", "my-bucket")
        monkeypatch.setenv("MINIO_ENDPOINT", "http://minio:9000")
        monkeypatch.setenv("MINIO_ACCESS_KEY", "mykey")
        monkeypatch.setenv("MINIO_SECRET_KEY", "mysecret")

        backend = get_storage_backend()
        assert isinstance(backend, S3Storage)
        assert backend.bucket == "my-bucket"
        assert backend.endpoint_url == "http://minio:9000"
