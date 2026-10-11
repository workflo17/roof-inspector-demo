"""Print the pixel size of each PNG given on the command line (reads the IHDR chunk)."""
import struct
import sys

for path in sys.argv[1:]:
    with open(path, "rb") as f:
        head = f.read(32)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        print(path, "NOT A PNG")
        continue
    w, h = struct.unpack(">II", head[16:24])
    print(path, w, "x", h)
