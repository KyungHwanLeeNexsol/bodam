"""크롤러 스토리지 백엔드 (SPEC-CRAWLER-001, SPEC-CRAWLER-002)

PDF 파일 저장을 위한 추상 인터페이스와 구현체.
LocalFileStorage: 로컬 파일 시스템 저장 (기본)
S3Storage: AWS S3/MinIO 저장 (boto3 기반, path-style 주소 지원)
get_storage_backend: 환경변수 기반 팩토리 함수
"""

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from pathlib import Path

logger = logging.getLogger(__name__)


class StorageBackend(ABC):
    """스토리지 백엔드 추상 기본 클래스

    PDF 파일 저장/조회/삭제를 위한 인터페이스 정의.
    """

    @abstractmethod
    def save(self, data: bytes, path: str) -> None:
        """데이터를 지정 경로에 저장

        Args:
            data: 저장할 바이너리 데이터
            path: 저장 경로 (base_dir 기준 상대 경로)
        """
        ...

    @abstractmethod
    def exists(self, path: str) -> bool:
        """파일 존재 여부 확인

        Args:
            path: 확인할 경로 (base_dir 기준 상대 경로)

        Returns:
            파일이 존재하면 True
        """
        ...

    @abstractmethod
    def get_path(
        self,
        company_code: str,
        product_code: str,
        filename: str = "",
        version: str = "",
    ) -> str:
        """표준화된 저장 경로 생성

        Args:
            company_code: 보험사 코드 (예: samsung-life)
            product_code: 상품 코드 (예: SL-001)
            filename: 파일명 (예: terms_v1.pdf). version과 상호 대체.
            version: 버전 식별자 (레거시). filename과 상호 대체.

        Returns:
            구조화된 상대 경로 문자열
        """
        ...

    @abstractmethod
    def delete(self, path: str) -> None:
        """파일 삭제

        Args:
            path: 삭제할 경로 (base_dir 기준 상대 경로)
        """
        ...


class LocalFileStorage(StorageBackend):
    """로컬 파일 시스템 기반 스토리지

    base_dir 하위에 파일을 저장.
    부모 디렉토리는 자동 생성.
    """

    def __init__(self, base_dir: str) -> None:
        """로컬 스토리지 초기화

        Args:
            base_dir: 파일 저장 기본 디렉토리 경로
        """
        self.base_dir = Path(base_dir)

    def save(self, data: bytes, path: str) -> None:
        """로컬 파일 시스템에 데이터 저장

        Args:
            data: 저장할 바이너리 데이터
            path: base_dir 기준 상대 경로
        """
        full_path = self.base_dir / path
        # 부모 디렉토리 자동 생성
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_bytes(data)

    def exists(self, path: str) -> bool:
        """파일 존재 여부 확인

        Args:
            path: base_dir 기준 상대 경로

        Returns:
            파일이 존재하면 True
        """
        return (self.base_dir / path).exists()

    def get_path(
        self,
        company_code: str,
        product_code: str,
        filename: str = "",
        version: str = "",
    ) -> str:
        """표준화된 저장 경로 생성

        형식: {company_code}/{product_code}/{filename_or_version}
        filename과 version 중 하나를 사용. filename 우선.

        Args:
            company_code: 보험사 코드
            product_code: 상품 코드
            filename: 파일명 (예: terms_v1.pdf 또는 latest.pdf)
            version: 버전 식별자 (레거시 파라미터, filename 없을 때 사용)

        Returns:
            구조화된 상대 경로 문자열
        """
        name = filename or version or "latest.pdf"
        return f"{company_code}/{product_code}/{name}"

    def delete(self, path: str) -> None:
        """로컬 파일 삭제

        존재하지 않는 파일은 조용히 무시.

        Args:
            path: base_dir 기준 상대 경로
        """
        full_path = self.base_dir / path
        if full_path.exists():
            full_path.unlink()


class S3Storage(StorageBackend):
    """AWS S3 / MinIO 기반 스토리지

    boto3를 사용하여 S3 호환 오브젝트 스토리지에 파일 저장.
    MinIO path-style 주소 지원 (endpoint_url 파라미터).
    """

    def __init__(
        self,
        bucket: str,
        endpoint_url: str | None,
        access_key: str | None,
        secret_key: str | None,
        base_dir: str = "",
        region_name: str = "auto",
    ) -> None:
        """S3/MinIO/Cloudflare R2 스토리지 초기화

        Args:
            bucket: S3 버킷 이름
            endpoint_url: S3 호환 엔드포인트 URL
                - MinIO (로컬): http://minio:9000
                - Cloudflare R2: https://{account_id}.r2.cloudflarestorage.com
                - AWS S3: None (기본 엔드포인트 사용)
            access_key: AWS Access Key ID / MinIO / R2 액세스 키
            secret_key: AWS Secret Access Key / MinIO / R2 시크릿 키
            base_dir: S3 키 접두사 (prefix). 빈 문자열이면 접두사 없음
            region_name: AWS 리전 (Cloudflare R2: 'auto', AWS S3: 'ap-northeast-2' 등)
        """
        self.bucket = bucket
        self.endpoint_url = endpoint_url
        self.access_key = access_key
        self.secret_key = secret_key
        self.base_dir = base_dir
        self.region_name = region_name

    def _get_client(self) -> object:
        """boto3 S3 클라이언트 생성

        MinIO 연결 시 endpoint_url과 path-style 주소를 사용.

        Returns:
            boto3 S3 클라이언트

        Raises:
            NotImplementedError: boto3 미설치 시
        """
        try:
            import boto3
        except ImportError as err:
            raise NotImplementedError("S3Storage는 boto3가 필요합니다") from err

        kwargs: dict = {}
        # 리전 설정: Cloudflare R2는 'auto', AWS S3는 'ap-northeast-2' 등
        kwargs["region_name"] = self.region_name
        if self.endpoint_url:
            # MinIO/R2 path-style addressing
            kwargs["endpoint_url"] = self.endpoint_url
            kwargs["config"] = __import__("botocore.config", fromlist=["Config"]).Config(
                signature_version="s3v4"
            )
        if self.access_key:
            kwargs["aws_access_key_id"] = self.access_key
        if self.secret_key:
            kwargs["aws_secret_access_key"] = self.secret_key

        return boto3.client("s3", **kwargs)

    def _build_key(self, path: str) -> str:
        """base_dir 접두사를 적용한 S3 키 생성

        Args:
            path: 상대 경로

        Returns:
            완전한 S3 키 문자열
        """
        return f"{self.base_dir}/{path}" if self.base_dir else path

    def save(self, data: bytes, path: str) -> str:
        """S3/MinIO에 데이터 저장

        Args:
            data: 저장할 바이너리 데이터
            path: S3 키 (base_dir 접두사 자동 적용)

        Returns:
            저장된 S3 키 문자열

        Raises:
            NotImplementedError: boto3 미설치 시
        """
        s3 = self._get_client()
        key = self._build_key(path)
        s3.put_object(Bucket=self.bucket, Key=key, Body=data)
        logger.debug("S3 업로드 완료: s3://%s/%s", self.bucket, key)
        return key

    def exists(self, path: str) -> bool:
        """S3/MinIO 객체 존재 여부 확인

        head_object를 사용하여 존재 여부만 경량 확인.

        Args:
            path: base_dir 기준 상대 경로

        Returns:
            S3 객체가 존재하면 True

        Raises:
            NotImplementedError: boto3 미설치 시
        """
        try:
            from botocore.exceptions import ClientError
        except ImportError as err:
            raise NotImplementedError("S3Storage는 boto3가 필요합니다") from err

        s3 = self._get_client()
        key = self._build_key(path)
        try:
            s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code in ("404", "NoSuchKey"):
                return False
            logger.error("S3 exists 확인 오류 (키: %s): %s", key, str(exc))
            raise

    def get_path(
        self,
        company_code: str,
        product_code: str,
        filename: str = "",
        version: str = "",
    ) -> str:
        """S3 키 생성

        형식: {company_code}/{product_code}/{filename_or_version}
        filename과 version 중 하나를 사용. filename 우선.

        Args:
            company_code: 보험사 코드
            product_code: 상품 코드
            filename: 파일명 (예: terms_v1.pdf 또는 latest.pdf)
            version: 버전 식별자 (레거시 파라미터, filename 없을 때 사용)

        Returns:
            S3 키 문자열
        """
        name = filename or version or "latest.pdf"
        return f"{company_code}/{product_code}/{name}"

    def delete(self, path: str) -> None:
        """S3/MinIO 객체 삭제

        존재하지 않는 객체 삭제 시 조용히 무시.

        Args:
            path: base_dir 기준 상대 경로

        Raises:
            NotImplementedError: boto3 미설치 시
        """
        s3 = self._get_client()
        key = self._build_key(path)
        s3.delete_object(Bucket=self.bucket, Key=key)
        logger.debug("S3 삭제 완료: s3://%s/%s", self.bucket, key)


def create_storage(backend_type: str, base_dir: str, **kwargs: object) -> StorageBackend:
    """스토리지 백엔드 팩토리 함수 (레거시)

    설정에 따라 적합한 스토리지 인스턴스를 반환.
    새 코드는 get_storage_backend()를 사용하세요.

    Args:
        backend_type: 스토리지 유형 ('local' 또는 's3')
        base_dir: 기본 디렉토리 경로 또는 S3 접두사
        **kwargs: 스토리지별 추가 설정

    Returns:
        StorageBackend 인스턴스

    Raises:
        ValueError: 지원하지 않는 backend_type 시
    """
    if backend_type == "local":
        return LocalFileStorage(base_dir=base_dir)
    elif backend_type == "s3":
        return S3Storage(
            bucket=str(kwargs.get("bucket", "")),
            endpoint_url=str(kwargs["endpoint_url"]) if kwargs.get("endpoint_url") else None,
            access_key=str(kwargs["access_key"]) if kwargs.get("access_key") else None,
            secret_key=str(kwargs["secret_key"]) if kwargs.get("secret_key") else None,
            base_dir=base_dir,
        )
    else:
        raise ValueError(f"지원하지 않는 스토리지 백엔드: {backend_type!r}. 'local' 또는 's3'를 사용하세요.")


# @MX:ANCHOR: [AUTO] 스토리지 백엔드 팩토리 함수
# @MX:REASON: S3Storage/LocalFileStorage 전환점, 환경변수 STORAGE_BACKEND로 제어, 3개 이상 모듈에서 호출 예정
def get_storage_backend() -> StorageBackend:
    """환경변수 기반 스토리지 백엔드 팩토리

    STORAGE_BACKEND 환경변수에 따라 적절한 스토리지 인스턴스 반환.
    - 'local' (기본값): 로컬 파일 시스템 스토리지
    - 's3': MinIO/AWS S3 스토리지

    환경변수:
        STORAGE_BACKEND: 스토리지 유형 ('local' 또는 's3', 기본값: 'local')
        PDF_STORAGE_PATH: 로컬 스토리지 경로 (기본값: './data/crawled_pdfs')
        MINIO_BUCKET: S3 버킷 이름 (기본값: 'bodam-pdfs')
        MINIO_ENDPOINT: MinIO 엔드포인트 URL (기본값: 'http://localhost:9000')
        MINIO_ACCESS_KEY: MinIO 액세스 키
        MINIO_SECRET_KEY: MinIO 시크릿 키

    Returns:
        StorageBackend 인스턴스
    """
    backend = os.getenv("STORAGE_BACKEND", "local")

    if backend == "s3":
        return S3Storage(
            bucket=os.getenv("MINIO_BUCKET", "bodam-pdfs"),
            endpoint_url=os.getenv("MINIO_ENDPOINT"),
            access_key=os.getenv("MINIO_ACCESS_KEY"),
            secret_key=os.getenv("MINIO_SECRET_KEY"),
            base_dir="",
            region_name=os.getenv("MINIO_REGION", "auto"),  # R2: 'auto', AWS: 'ap-northeast-2'
        )

    storage_path = os.getenv("PDF_STORAGE_PATH", "./data/crawled_pdfs")
    return LocalFileStorage(base_dir=storage_path)
