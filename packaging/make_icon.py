#!/usr/bin/env python3
"""生成 DocViewer 应用图标。

设计 = 应用内 logo：绿色圆角方块（macOS 标准图标栅格）+ 居中的书本符号（lucide `book`）。
几何按参考图实测：方块 824/1024（留 100px 边距），圆角 185；
符号高度 = 方块高度的 60%，居中。
"""
from PIL import Image, ImageDraw
import math
import os
import sys

# ---- 配色（按参考图取样）----
GREEN_TOP = (92, 205, 32)     # #5CCD20
GREEN_BOT = (76, 182, 22)     # #4CB616
INK = (10, 20, 8)             # #0A1408 近黑，带一点绿

SQUARE = 824.0                # 方块边长（1024 画布）
PAD = (1024.0 - SQUARE) / 2   # 100
RADIUS = 185.0                # macOS 标准圆角

# lucide `book`（24×24 栅格）
BOOK_TOP, BOOK_BOTTOM = 2.0, 22.0
BOOK_LEFT, BOOK_RIGHT = 4.0, 21.0
STROKE = 2.0                  # lucide 默认描边宽度（同一栅格）


def arc(cx, cy, r, a0, a1, steps=32):
    """采样圆弧（角度制，y 轴向下）。"""
    pts = []
    for i in range(steps + 1):
        t = math.radians(a0 + (a1 - a0) * i / steps)
        pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    return pts


def book_polylines():
    """两条折线，合起来即 lucide book。"""
    out = []
    # 底边：M4 19.5 A2.5 2.5 0 0 1 6.5 17 H20
    p = arc(6.5, 19.5, 2.5, 180, 270) + [(6.5, 17.0), (20.0, 17.0)]
    out.append(p)
    # 封面：M6.5 2 H20 v20 H6.5 A2.5 2.5 0 0 1 4 19.5 v-15 A2.5 2.5 0 0 1 6.5 2 z
    p2 = [(6.5, 2.0), (20.0, 2.0), (20.0, 22.0), (6.5, 22.0)]
    p2 += arc(6.5, 19.5, 2.5, 90, 180)
    p2 += [(4.0, 19.5), (4.0, 4.5)]
    p2 += arc(6.5, 4.5, 2.5, 180, 270)
    p2 += [(6.5, 2.0)]
    out.append(p2)
    return out


def squircle_mask(size, box, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle(box, radius=radius, fill=255)
    return m


def make(size=1024):
    S = size
    k = S / 1024.0
    pad, sq, rad = PAD * k, SQUARE * k, RADIUS * k
    box = [pad, pad, pad + sq, pad + sq]

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # 圆角方块：极轻的竖向渐变
    grad = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    y0, y1 = int(pad), int(pad + sq)
    for y in range(y0, y1 + 1):
        t = (y - y0) / max(1, (y1 - y0))
        gd.line([(0, y), (S, y)], fill=(
            int(GREEN_TOP[0] * (1 - t) + GREEN_BOT[0] * t),
            int(GREEN_TOP[1] * (1 - t) + GREEN_BOT[1] * t),
            int(GREEN_TOP[2] * (1 - t) + GREEN_BOT[2] * t), 255))
    img.paste(grad, (0, 0), squircle_mask(S, box, rad))

    # 书本：等比缩放并居中
    gw, gh = (BOOK_RIGHT - BOOK_LEFT), (BOOK_BOTTOM - BOOK_TOP)
    unit = (sq * 0.60) / gh
    ox = pad + (sq - gw * unit) / 2 - BOOK_LEFT * unit
    oy = pad + (sq - gh * unit) / 2 - BOOK_TOP * unit

    def T(p):
        return (ox + p[0] * unit, oy + p[1] * unit)

    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    w = max(1, int(round(STROKE * unit)))
    r = w / 2.0
    for line in book_polylines():
        pts = [T(p) for p in line]
        ld.line(pts, fill=INK + (255,), width=w, joint="curve")
        for p in pts:                                  # 圆头端帽 + 圆角转折
            ld.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=INK + (255,))
    img.alpha_composite(layer)
    return img


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "DocViewer.icns")
    iconset = os.path.join(os.path.dirname(os.path.abspath(out)), "DocViewer.iconset")
    os.makedirs(iconset, exist_ok=True)

    master = make(1024)
    master.save(os.path.join(iconset, "icon_512x512@2x.png"))
    sizes = [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2),
             (256, 1), (256, 2), (512, 1), (512, 2)]
    for base, scale in sizes:
        px = base * scale
        name = "icon_%dx%d%s.png" % (base, base, "@2x" if scale == 2 else "")
        img = master if px == 1024 else master.resize((px, px), Image.LANCZOS)
        img.save(os.path.join(iconset, name))
    print("iconset 已生成：", iconset)
    # B13：以前只生成 iconset，从不调用 iconutil，所以 out（.icns）永远不更新，
    # 打包时用的还是旧图标。这里补上转换并校验产物。
    try:
        import subprocess
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", out], check=True)
        if not os.path.exists(out):
            raise RuntimeError("iconutil 没有产出 .icns")
        print("icns 已生成：", out, os.path.getsize(out), "字节")
    except FileNotFoundError:
        print("找不到 iconutil（需要 macOS），只生成了 iconset：", iconset)
        raise SystemExit(1)
    print("预览：", os.path.join(iconset, "icon_512x512@2x.png"))


if __name__ == "__main__":
    main()
