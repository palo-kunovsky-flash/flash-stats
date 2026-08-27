#!/usr/bin/env python3
"""Generate the app icon and the menu-bar template icon (no dependencies).

    python3 scripts/gen_icons.py

Writes design/app-icon.png (1024x1024) and design/tray-template.png (36x36).
Run `npx tauri icon design/app-icon.png` afterwards to build the icon set.
"""
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "design")


def write_png(path, w, h, px):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)  # filter: none
        raw += px[y * stride : (y + 1) * stride]

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    blob = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as fh:
        fh.write(blob)
    print("wrote", path)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(lerp(c1[i], c2[i], t) for i in range(3))


def squircle_alpha(x, y, size, radius):
    """Signed distance to a rounded square, in pixels (<0 inside)."""
    half = size / 2.0
    cx, cy = half, half
    qx = abs(x - cx) - (half - radius)
    qy = abs(y - cy) - (half - radius)
    ox = max(qx, 0.0)
    oy = max(qy, 0.0)
    return math.hypot(ox, oy) + min(max(qx, qy), 0.0) - radius


def seg_distance(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    len2 = vx * vx + vy * vy
    t = 0.0 if len2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / len2))
    return math.hypot(px - (ax + vx * t), py - (ay + vy * t))


def antialias(dist, edge=1.2):
    if dist <= -edge:
        return 1.0
    if dist >= edge:
        return 0.0
    return 0.5 - dist / (2 * edge)


def app_icon(size=1024):
    px = bytearray(size * size * 4)
    radius = size * 0.2237  # macOS squircle-ish
    pad = size * 0.0
    top = (52, 58, 68)
    bottom = (17, 19, 24)

    # sparkline points (normalised 0..1 in the inner box)
    pts = [(0.10, 0.72), (0.24, 0.46), (0.37, 0.58), (0.50, 0.28),
           (0.63, 0.42), (0.76, 0.18), (0.90, 0.34)]

    # bars behind the line
    bars = [(0.14, 0.30), (0.34, 0.52), (0.54, 0.22), (0.74, 0.62)]
    inner = size * 0.86
    ox = (size - inner) / 2.0
    oy = (size - inner) / 2.0
    stroke = size * 0.045

    for y in range(size):
        for x in range(size):
            d = squircle_alpha(x, y, size - 2 * pad, radius)
            cover = antialias(d)
            if cover <= 0.001:
                continue

            t = y / size
            col = mix(top, bottom, min(1.0, max(0.0, t)))
            # soft light from the top edge
            col = tuple(min(255.0, c + 22.0 * max(0.0, 1.0 - y / (size * 0.30))) for c in col)

            # bars (bottom aligned), subtle grey
            for (bx, bh) in bars:
                x0 = ox + inner * bx
                x1 = x0 + inner * 0.10
                y1 = oy + inner * 0.86
                y0 = y1 - inner * bh
                if x0 <= x < x1 and y0 <= y < y1:
                    bw = inner * 0.10
                    f = (x - x0) / bw
                    bar = mix((70, 78, 92), (96, 106, 124), f)
                    a = antialias(-2.0)
                    col = mix(col, bar, 0.55 * a)

            # sparkline (cyan -> violet), with a glow
            best = 1e9
            seg_i = 0
            for i in range(len(pts) - 1):
                ax = ox + inner * pts[i][0]
                ay = oy + inner * pts[i][1]
                bx = ox + inner * pts[i + 1][0]
                by = oy + inner * pts[i + 1][1]
                dd = seg_distance(x, y, ax, ay, bx, by)
                if dd < best:
                    best = dd
                    seg_i = i
                    prog = i / (len(pts) - 1)
            if best < stroke * 3.0:
                cyan = (86, 226, 255)
                violet = (176, 132, 255)
                line = mix(cyan, violet, seg_i / (len(pts) - 1))
                core = antialias(best - stroke / 2.0)
                glow = antialias(best - stroke * 2.2) * 0.30
                col = mix(col, line, min(1.0, glow))
                col = mix(col, line, core)

            i4 = (y * size + x) * 4
            px[i4 : i4 + 3] = bytes(int(round(c)) for c in col)
            px[i4 + 3] = int(round(255 * cover))
    return bytes(px)


def tray_template(size=36):
    """Monochrome bar glyph with transparent background (macOS template image)."""
    px = bytearray(size * size * 4)
    bars = [(0.10, 0.35), (0.36, 0.62), (0.62, 0.90)]
    bar_w = size * 0.24
    base = size * 0.86
    top_pad = size * 0.12
    for y in range(size):
        for x in range(size):
            inside = False
            for (bx, bh) in bars:
                x0 = size * bx + size * 0.03
                y1 = base
                y0 = base - (base - top_pad) * bh
                if x0 <= x < x0 + bar_w and y0 <= y < y1:
                    inside = True
            i4 = (y * size + x) * 4
            if inside:
                px[i4 : i4 + 4] = bytes((0, 0, 0, 255))
    return bytes(px)


def main():
    os.makedirs(OUT, exist_ok=True)
    write_png(os.path.join(OUT, "app-icon.png"), 1024, 1024, app_icon(1024))
    write_png(os.path.join(OUT, "tray-template.png"), 36, 36, tray_template(36))


if __name__ == "__main__":
    main()
