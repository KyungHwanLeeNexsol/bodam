#!/usr/bin/env python3
"""kpub HTML 파일에서 다운로드 링크 분석"""
import re
from pathlib import Path

data_dir = Path("C:/Users/Nexsol/Documents/bodam/backend/data")
fnames = ["kpub_sickness.html", "kpub_accident.html", "kpub_accident_saving.html"]

for fname in fnames:
    fpath = data_dir / fname
    if not fpath.exists():
        print(f"{fname}: 파일 없음")
        continue
    html = fpath.read_text(encoding="utf-8", errors="replace")
    dls = set(re.findall(r"/file/download/[A-Za-z0-9+=/]+", html))
    pdfs = set(re.findall(r'href="([^"]+\.pdf)"', html))
    fn_downs = re.findall(r"fn_fileDown[^;]+;", html)
    print(f"{fname}: size={len(html)} dl={len(dls)} pdfs={len(pdfs)} fn={len(fn_downs)}")
    for d in list(dls)[:3]:
        print(f"  dl: {d}")
    for p in list(pdfs)[:3]:
        print(f"  pdf: {p}")
