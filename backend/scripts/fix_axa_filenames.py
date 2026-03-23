#!/usr/bin/env python3
"""AXA손해보험 PDF/JSON 파일명 깨짐 수정 스크립트

파일명이 '蹂닿린'으로 저장된 파일들을 source_url의 파일명 stem으로 수정한다.
"""
from __future__ import annotations

import json
import logging
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


def main() -> None:
    data_dir = Path(__file__).parent.parent / "data" / "axa_general"
    if not data_dir.exists():
        logger.error("디렉토리 없음: %s", data_dir)
        return

    json_files = sorted(data_dir.glob("*.json"))
    logger.info("총 %d개 JSON 메타데이터 파일 발견", len(json_files))

    renamed = 0
    skipped = 0
    errors = 0

    for json_path in json_files:
        try:
            meta = json.loads(json_path.read_text(encoding="utf-8"))
            source_url = meta.get("source_url", "")
            if not source_url:
                skipped += 1
                continue

            # source_url에서 파일명 stem 추출
            url_path = urlparse(source_url).path
            url_stem = Path(url_path).stem
            if not url_stem:
                skipped += 1
                continue

            # 안전한 파일명 생성
            safe_stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", url_stem.strip())
            safe_stem = safe_stem.strip(".").strip()[:80] or "unknown"

            current_pdf_name = Path(meta.get("file_path", "")).name
            if not current_pdf_name:
                skipped += 1
                continue

            current_pdf_path = data_dir / current_pdf_name
            current_json_path = json_path

            # 새 파일명
            new_pdf_name = f"{safe_stem}.pdf"
            new_pdf_path = data_dir / new_pdf_name
            new_json_name = f"{safe_stem}.json"
            new_json_path = data_dir / new_json_name

            # 이미 올바른 파일명인 경우 스킵
            if current_pdf_path.name == new_pdf_name:
                skipped += 1
                continue

            # 대상 파일이 이미 존재하면 해시 suffix 추가
            file_hash_suffix = meta.get("file_hash", "")[-8:] if meta.get("file_hash") else ""
            if new_pdf_path.exists() and new_pdf_path != current_pdf_path:
                new_pdf_name = f"{safe_stem}_{file_hash_suffix}.pdf"
                new_pdf_path = data_dir / new_pdf_name
                new_json_name = f"{safe_stem}_{file_hash_suffix}.json"
                new_json_path = data_dir / new_json_name

            # PDF 파일 이름 변경
            if current_pdf_path.exists():
                current_pdf_path.rename(new_pdf_path)
            else:
                logger.warning("  PDF 파일 없음: %s", current_pdf_path)

            # JSON 메타데이터 업데이트
            meta["product_name"] = safe_stem
            meta["file_path"] = f"axa_general/{new_pdf_name}"
            new_json_path.write_text(
                json.dumps(meta, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            # 이전 JSON 파일 삭제 (새 경로가 다른 경우)
            if current_json_path != new_json_path and current_json_path.exists():
                current_json_path.unlink()

            renamed += 1
            if renamed % 100 == 0:
                logger.info("  진행: %d개 완료", renamed)

        except Exception as exc:
            logger.error("  오류 (%s): %s", json_path.name, exc)
            errors += 1

    logger.info(
        "완료: %d개 이름 변경, %d개 스킵, %d개 오류",
        renamed,
        skipped,
        errors,
    )


if __name__ == "__main__":
    main()
