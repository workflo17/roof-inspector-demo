"""Summarise a PDF: page count, page size, embedded image count and the first lines of each page's text.

Usage: python tools/pdf_info.py qa/report.pdf
"""
import sys

from pypdf import PdfReader

reader = PdfReader(sys.argv[1])
print("pages:", len(reader.pages))
for n, page in enumerate(reader.pages, 1):
    w, h = float(page.mediabox.width), float(page.mediabox.height)
    images = len(page.images)
    text = (page.extract_text() or "").strip().splitlines()
    head = " | ".join(t.strip() for t in text[:4])
    print(f"page {n}: {w:.0f}x{h:.0f}pt, {images} image(s), {len(text)} text lines :: {head[:150]}")
