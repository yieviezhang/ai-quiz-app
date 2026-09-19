#!/usr/bin/env python3
"""Generate the app icons. No dependencies — writes PNGs directly.

    python3 tools/make-icons.py

Mark: a white 3/4 progress ring with a centre dot, on the app's blue
gradient. Same motif as the progress rings inside the app.
"""

import math
import os
import struct
import zlib

GRAD_A = (0x4D, 0xA8, 0xFF)   # --accent-grad-a
GRAD_B = (0x0A, 0x6B, 0xE0)   # --accent-grad-b
SIZES = [180, 192, 512]
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'icons')


def coverage(signed_distance):
    """1 inside, 0 outside, antialiased across one pixel."""
    return min(1.0, max(0.0, 0.5 - signed_distance))


def mark_mask(x, y, size):
    cx = cy = (size - 1) / 2.0
    r = 0.300 * size          # ring radius
    t = 0.105 * size          # ring thickness
    dot_r = 0.082 * size

    dx, dy = x - cx, y - cy
    dist = math.hypot(dx, dy)

    # Arc spans 270 degrees clockwise from the top; the rounded caps below
    # smooth both terminations, so a hard angular cut is fine here.
    angle = math.degrees(math.atan2(dx, -dy)) % 360.0
    m = coverage(abs(dist - r) - t / 2.0) if angle <= 270.0 else 0.0

    for deg in (0.0, 270.0):
        rad = math.radians(deg)
        ex = cx + r * math.sin(rad)
        ey = cy - r * math.cos(rad)
        m = max(m, coverage(math.hypot(x - ex, y - ey) - t / 2.0))

    return max(m, coverage(dist - dot_r))


def render(size):
    rows = []
    for y in range(size):
        row = bytearray([0])  # PNG filter byte: none
        for x in range(size):
            g = (x + y) / (2.0 * (size - 1))          # diagonal gradient
            base = [round(a + (b - a) * g) for a, b in zip(GRAD_A, GRAD_B)]
            m = mark_mask(x, y, size)
            row += bytes(round(c + (255 - c) * m) for c in base)
            row += b'\xff'
        rows.append(bytes(row))
    return b''.join(rows)


def chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png(path, size, raw):
    header = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', header)
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f'icon-{size}.png')
        write_png(path, size, render(size))
        print(f'{path}  ({size}x{size})')


if __name__ == '__main__':
    main()
