#!/usr/bin/env python
"""크롤러 완료 대기 후 Neon 인제스트 자동 실행.

크롤러(crawl_*) 프로세스가 모두 종료되면 ingest_local_pdfs 를 실행한다.
"""
from __future__ import annotations

import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

PYTHON = r"C:\Python313\python.exe"
LOG_PATH = Path(__file__).parent / "ingest_auto.log"


def log(msg: str) -> None:
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def get_crawlers() -> list[tuple[int, str]]:
    """실행 중인 crawl_ 프로세스 목록 반환."""
    import os
    running = []
    try:
        for pid_str in os.listdir("/proc"):
            if not pid_str.isdigit():
                continue
            try:
                cmdline_path = f"/proc/{pid_str}/cmdline"
                with open(cmdline_path, "rb") as f:
                    cmdline = f.read().replace(b"\x00", b" ").decode("utf-8", errors="replace")
                if "crawl_" in cmdline and "python" in cmdline.lower():
                    script = [p for p in cmdline.split() if "crawl_" in p]
                    running.append((int(pid_str), script[0] if script else cmdline[:60]))
            except (PermissionError, FileNotFoundError, ProcessLookupError):
                continue
    except Exception:
        pass
    return running


def main() -> None:
    log("=" * 50)
    log("크롤러 완료 대기 시작...")

    # 크롤러 완료 대기
    while True:
        crawlers = get_crawlers()
        if not crawlers:
            log("모든 크롤러 완료!")
            break
        names = ", ".join(name for _, name in crawlers)
        log(f"크롤러 실행 중: {names} → 30초 후 재확인")
        time.sleep(30)

    # ingest_local_pdfs 실행
    log("Neon 인제스트 시작...")
    backend_dir = Path(__file__).parent.parent
    env_vars = {"PYTHONIOENCODING": "utf-8", "PYTHONPATH": str(backend_dir)}

    import os
    full_env = {**os.environ, **env_vars}

    result = subprocess.run(
        [PYTHON, "-m", "scripts.ingest_local_pdfs"],
        cwd=backend_dir,
        env=full_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    for line in result.stdout.splitlines():
        log(line)

    if result.returncode == 0:
        log("인제스트 완료!")
    else:
        log(f"인제스트 실패 (exit code: {result.returncode})")

    log("=" * 50)


if __name__ == "__main__":
    main()
