"""크롤러 스토리지 백엔드 (SPEC-CRAWLER-001)

PDF 파일 저장을 위한 추상 인터페이스와 구현체.
LocalFileStorage: 로컬 파일 시스템 저장 (기본)
S3Storage: AWS S3 저장 (스텁, 인터페이스만 정의)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path


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
    def get_path(self, company_code: str, product_code: str, version: str) -> str:
        """표준화된 저장 경로 생성

        Args:
            company_code: 보험사 코드 (예: samsung-life)
            product_code: 상품 코드 (예: SL-001)
            version: 버전 식별자 (예: 20240101)

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

    def get_path(self, company_code: str, product_code: str, version: str) -> str:
        """표준화된 저장 경로 생성

        형식: {company_code}/{product_code}/{version}.pdf

        Args:
            company_code: 보험사 코드
            product_code: 상품 코드
            version: 버전 식별자

        Returns:
            구조화된 상대 경로 문자열
        """
        return f"{company_code}/{product_code}/{version}.pdf"

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
    """AWS S3 기반 스토리지 (스텁 구현)

    인터페이스 정의 목적. boto3 사용 가능 시 save() 동작.
    비필수 메서드는 NotImplementedError 발생.
    """

    def __init__(self, base_dir: str, bucket: str = "", **kwargs: object) -> None:
        """S3 스토리지 초기화

        Args:
            base_dir: S3 키 접두사 (prefix)
            bucket: S3 버킷 이름
            **kwargs: 추가 S3 설정 (region, credentials 등)
        """
        self.base_dir = base_dir
        self.bucket = bucket
        self.kwargs = kwargs

    def save(self, data: bytes, path: str) -> None:
        """S3에 데이터 저장 (boto3 필요)

        Args:
            data: 저장할 바이너리 데이터
            path: S3 키 (base_dir 접두사 적용)

        Raises:
            NotImplementedError: boto3 미설치 시
        """
        try:
            import boto3

            s3 = boto3.client("s3", **self.kwargs)
            key = f"{self.base_dir}/{path}" if self.base_dir else path
            s3.put_object(Bucket=self.bucket, Key=key, Body=data)
        except ImportError as err:
            raise NotImplementedError("S3Storage는 boto3가 필요합니다") from err

    def exists(self, path: str) -> bool:
        """S3 객체 존재 여부 확인

        Args:
            path: base_dir 기준 상대 경로

        Returns:
            S3 객체가 존재하면 True

        Raises:
            NotImplementedError: boto3 미설치 시
        """
        try:
            import boto3
            from botocore.exceptions import ClientError

            s3 = boto3.client("s3", **self.kwargs)
            key = f"{self.base_dir}/{path}" if self.base_dir else path
            try:
                s3.head_object(Bucket=self.bucket, Key=key)
                return True
            except ClientError as e:
                if e.response["Error"]["Code"] == "404":
                    return False
                raise
        except ImportError as err:
            raise NotImplementedError("S3Storage는 boto3가 필요합니다") from err

    def get_path(self, company_code: str, product_code: str, version: str) -> str:
        """S3 키 생성

        Args:
            company_code: 보험사 코드
            product_code: 상품 코드
            version: 버전 식별자

        Returns:
            S3 키 문자열
        """
        return f"{company_code}/{product_code}/{version}.pdf"

    def delete(self, path: str) -> None:
        """S3 객체 삭제

        존재하지 않는 객체는 조용히 무시.

        Args:
            path: base_dir 기준 상대 경로

        Raises:
            NotImplementedError: boto3 미설치 시
        """
        try:
            import boto3

            s3 = boto3.client("s3", **self.kwargs)
            key = f"{self.base_dir}/{path}" if self.base_dir else path
            s3.delete_object(Bucket=self.bucket, Key=key)
        except ImportError as err:
            raise NotImplementedError("S3Storage는 boto3가 필요합니다") from err


def create_storage(backend_type: str, base_dir: str, **kwargs: object) -> StorageBackend:
    """스토리지 백엔드 팩토리 함수

    설정에 따라 적합한 스토리지 인스턴스를 반환.

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
        return S3Storage(base_dir=base_dir, **kwargs)
    else:
        raise ValueError(f"지원하지 않는 스토리지 백엔드: {backend_type!r}. 'local' 또는 's3'를 사용하세요.")
