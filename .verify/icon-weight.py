"""
在真实的 16px 尺寸下比较两个工具栏图标的视觉重量（墨水覆盖率与视觉重心）。

优先用本机无头浏览器渲染（结果最可信）；找不到浏览器时（例如 GitHub runner
只装了 chromium 而非 Edge/Chrome）自动回退到内置的扫描线光栅化，因此这个脚本
既能在本机做精细校验，也能在 CI 里作为门禁。

用法：
    python3 .verify/icon-weight.py            # 自动选择渲染方式
    python3 .verify/icon-weight.py shot.png   # 分析已有截图
"""
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CLIENT = ROOT / 'client.js'
PX = 16
SCALE = 8  # 设备缩放，用于抗锯齿统计

BROWSERS = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
]


# ---------------------------------------------------------------------------
# 从 client.js 提取图标
# ---------------------------------------------------------------------------
def svg_of(name, px):
    src = CLIENT.read_text(encoding='utf-8')
    start = src.index('function %s(' % name)
    end = src.index('\n    }', start)
    body = src[start:end]
    paths = re.findall(r"d: '([^']+)'", body)
    vb = re.search(r"viewBox: '([^']+)'", body)
    vb = vb.group(1) if vb else '0 0 16 16'
    par = re.search(r"preserveAspectRatio: '([^']+)'", body)
    par = par.group(1) if par else 'xMidYMid meet'
    attrs = ''.join('<path d="%s" fill="#000"/>' % d for d in paths)
    return ('<svg viewBox="%s" preserveAspectRatio="%s" width="%d" height="%d" '
            'xmlns="http://www.w3.org/2000/svg">%s</svg>' % (vb, par, px, px, attrs))


def viewbox_of(name):
    src = CLIENT.read_text(encoding='utf-8')
    start = src.index('function %s(' % name)
    end = src.index('\n    }', start)
    body = src[start:end]
    vb = re.search(r"viewBox: '([^']+)'", body)
    return [float(v) for v in vb.group(1).split()] if vb else [0.0, 0.0, 16.0, 16.0]


def paths_of(name):
    src = CLIENT.read_text(encoding='utf-8')
    start = src.index('function %s(' % name)
    end = src.index('\n    }', start)
    return re.findall(r"d: '([^']+)'", src[start:end])


# ---------------------------------------------------------------------------
# 内置光栅化（无浏览器时的回退）
# ---------------------------------------------------------------------------
def _tokenize(d):
    return re.findall(r'[AaCcHhLlMmQqSsTtVvZz]|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?', d)


def _arc_points(x0, y0, rx, ry, phi_deg, large_arc, sweep, x, y, steps=32):
    if rx == 0 or ry == 0:
        return [(x, y)]
    phi = math.radians(phi_deg)
    cos_p, sin_p = math.cos(phi), math.sin(phi)
    dx2, dy2 = (x0 - x) / 2.0, (y0 - y) / 2.0
    x1 = cos_p * dx2 + sin_p * dy2
    y1 = -sin_p * dx2 + cos_p * dy2
    rx, ry = abs(rx), abs(ry)
    lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
    if lam > 1:
        scale = math.sqrt(lam)
        rx *= scale
        ry *= scale
    num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
    den = rx * rx * y1 * y1 + ry * ry * x1 * x1
    factor = math.sqrt(max(0.0, num / den)) if den else 0.0
    if large_arc == sweep:
        factor = -factor
    cxp = factor * rx * y1 / ry
    cyp = -factor * ry * x1 / rx
    cx = cos_p * cxp - sin_p * cyp + (x0 + x) / 2.0
    cy = sin_p * cxp + cos_p * cyp + (y0 + y) / 2.0

    def angle(ux, uy, vx, vy):
        dot = ux * vx + uy * vy
        norm = math.hypot(ux, uy) * math.hypot(vx, vy)
        if norm == 0:
            return 0.0
        value = max(-1.0, min(1.0, dot / norm))
        sign = -1.0 if (ux * vy - uy * vx) < 0 else 1.0
        return sign * math.acos(value)

    theta1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
    dtheta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
    if not sweep and dtheta > 0:
        dtheta -= 2 * math.pi
    elif sweep and dtheta < 0:
        dtheta += 2 * math.pi
    pts = []
    for i in range(1, steps + 1):
        t = theta1 + dtheta * i / steps
        px = cos_p * rx * math.cos(t) - sin_p * ry * math.sin(t) + cx
        py = sin_p * rx * math.cos(t) + cos_p * ry * math.sin(t) + cy
        pts.append((px, py))
    return pts


def _parse_path(d):
    toks = _tokenize(d)
    subpaths = []
    current = []
    cx = cy = sx = sy = 0.0
    prev_cmd = None
    prev_cx = prev_cy = None
    state = {'i': 0}

    def num():
        index = state['i']
        value = float(toks[index])
        state['i'] = index + 1
        return value

    def is_cmd(tok):
        return bool(re.fullmatch(r'[AaCcHhLlMmQqSsTtVvZz]', tok))

    while state['i'] < len(toks):
        tok = toks[state['i']]
        if is_cmd(tok):
            cmd = tok
            state['i'] += 1
        elif prev_cmd is None:
            break
        else:
            cmd = 'L' if prev_cmd == 'M' else 'l' if prev_cmd == 'm' else prev_cmd
        rel = cmd.islower()
        c = cmd.upper()

        if c == 'Z':
            if current:
                subpaths.append(current)
                current = []
            cx, cy = sx, sy
            prev_cmd = cmd
            prev_cx = prev_cy = None
            continue
        if c == 'M':
            x, y = num(), num()
            cx = cx + x if rel else x
            cy = cy + y if rel else y
            sx, sy = cx, cy
            if current:
                subpaths.append(current)
            current = [(cx, cy)]
            prev_cx = prev_cy = None
        elif c == 'L':
            x, y = num(), num()
            cx = cx + x if rel else x
            cy = cy + y if rel else y
            current.append((cx, cy))
            prev_cx, prev_cy = cx, cy
        elif c == 'T':
            x, y = num(), num()
            nx = cx + x if rel else x
            ny = cy + y if rel else y
            x1 = 2 * cx - prev_cx if prev_cx is not None else cx
            y1 = 2 * cy - prev_cy if prev_cy is not None else cy
            for k in range(1, 13):
                t = k / 12.0
                mt = 1 - t
                current.append((mt * mt * cx + 2 * mt * t * x1 + t * t * nx,
                                mt * mt * cy + 2 * mt * t * y1 + t * t * ny))
            prev_cx, prev_cy = x1, y1
            cx, cy = nx, ny
        elif c == 'H':
            x = num()
            cx = cx + x if rel else x
            current.append((cx, cy))
        elif c == 'V':
            y = num()
            cy = cy + y if rel else y
            current.append((cx, cy))
        elif c in ('C', 'S', 'Q'):
            if c == 'C':
                x1, y1, x2, y2, x, y = (num() for _ in range(6))
            elif c == 'S':
                x2, y2, x, y = (num() for _ in range(4))
                if prev_cx is not None:
                    x1, y1 = 2 * cx - prev_cx, 2 * cy - prev_cy
                else:
                    x1, y1 = cx, cy
            else:
                x1, y1, x, y = (num() for _ in range(4))
                x2, y2 = 2 * x1 - cx, 2 * y1 - cy
            if rel:
                x1, y1, x2, y2, x, y = (cx + v if rel else v for v in (x1, y1, x2, y2, x, y))
            for k in range(1, 17):
                t = k / 16.0
                mt = 1 - t
                current.append((
                    mt ** 3 * cx + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t ** 3 * x,
                    mt ** 3 * cy + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t ** 3 * y,
                ))
            prev_cx, prev_cy = x2, y2
            cx, cy = x, y
        elif c == 'A':
            rx, ry, rot = num(), num(), num()
            large_arc, sweep = int(num()), int(num())
            x, y = num(), num()
            nx = cx + x if rel else x
            ny = cy + y if rel else y
            current.extend(_arc_points(cx, cy, rx, ry, rot, large_arc, sweep, nx, ny))
            prev_cx = prev_cy = None
            cx, cy = nx, ny
        else:
            state['i'] += 1
            continue
        prev_cmd = cmd

    if current:
        subpaths.append(current)
    return subpaths


def _fill_mask(subpaths, width, height, samples=4):
    """扫描线 + nonzero 填充，返回 0/1 掩码。"""
    mask = [[0] * width for _ in range(height)]
    edges = []
    for pts in subpaths:
        n = len(pts)
        if n < 2:
            continue
        for k in range(n):
            x1, y1 = pts[k]
            x2, y2 = pts[(k + 1) % n]
            if y1 != y2:
                edges.append((x1, y1, x2, y2))
    for py in range(height):
        for s in range(samples):
            y = py + (s + 0.5) / samples
            xs = []
            for x1, y1, x2, y2 in edges:
                if (y1 <= y < y2) or (y2 <= y < y1):
                    t = (y - y1) / (y2 - y1)
                    xs.append((x1 + t * (x2 - x1), 1 if y2 > y1 else -1))
            if not xs:
                continue
            xs.sort()
            winding = 0
            spans = []
            for idx in range(len(xs) - 1):
                winding += xs[idx][1]
                if winding != 0:
                    spans.append((xs[idx][0], xs[idx + 1][0]))
            for xa, xb in spans:
                for px in range(width):
                    for t in range(samples):
                        x = px + (t + 0.5) / samples
                        if xa <= x < xb:
                            mask[py][px] = 1
                            break
    return mask


def rasterize_locally(name):
    """把图标光栅化到 PX*SCALE 像素的灰度图（无浏览器回退）。"""
    vb = viewbox_of(name)
    _, _, vb_w, vb_h = vb
    size = PX * SCALE
    # 视口按 preserveAspectRatio=xMidYMid meet 等比缩放到正方形框内
    scale = min(size / vb_w, size / vb_h)
    off_x = (size - vb_w * scale) / 2.0
    off_y = (size - vb_h * scale) / 2.0

    subpaths = []
    for d in paths_of(name):
        subpaths.extend(_parse_path(d))
    scaled = [[(x * scale + off_x, y * scale + off_y) for (x, y) in pts] for pts in subpaths]

    mask = _fill_mask(scaled, size, size)
    img = Image.new('L', (size, size), 255)
    px = img.load()
    for y in range(size):
        for x in range(size):
            if mask[y][x]:
                px[x, y] = 0
    return img


# ---------------------------------------------------------------------------
# 浏览器渲染（首选）
# ---------------------------------------------------------------------------
def render_with_browser():
    browser = next((b for b in BROWSERS if os.path.exists(b)), None)
    if not browser:
        return None
    html = """<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#fff}
.cell{width:%dpx;height:%dpx;overflow:hidden}
.cell svg{display:block}</style>
<div class="cell">%s</div><div class="cell">%s</div>""" % (
        PX, PX, svg_of('IconSparkle', PX), svg_of('IconUndo', PX))
    work = Path(tempfile.mkdtemp(prefix='dsh-weight-'))
    page = work / 'w.html'
    shot = work / 'shot.png'
    page.write_text(html, encoding='utf-8')
    try:
        subprocess.run(
            [browser, '--headless=new', '--disable-gpu', '--hide-scrollbars',
             '--force-device-scale-factor=%d' % SCALE,
             '--screenshot=%s' % shot, '--window-size=%d,%d' % (PX, PX * 2),
             'file:///%s' % page.as_posix()],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
        )
        if not shot.exists():
            return None
        img = Image.open(shot).convert('L')
        # 拼成单图，便于复用同一套统计逻辑
        combined = Image.new('L', (PX * SCALE, PX * SCALE * 2), 255)
        combined.paste(img.crop((0, 0, PX * SCALE, PX * SCALE)), (0, 0))
        combined.paste(img.crop((0, PX * SCALE, PX * SCALE, PX * SCALE * 2)), (0, PX * SCALE))
        return combined
    except Exception:
        return None
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ---------------------------------------------------------------------------
# 统计
# ---------------------------------------------------------------------------
def analyse(img):
    width, height = img.size
    cell_h = height // 2
    stats = {}
    for label, top in (('sparkle', 0), ('undo', cell_h)):
        crop = img.crop((0, top, width, top + cell_h))
        px = crop.load()
        w, h = crop.size
        total = w * h
        ink = 0.0
        sum_x = 0.0
        sum_y = 0.0
        min_x, min_y, max_x, max_y = w, h, 0, 0
        for y in range(h):
            for x in range(w):
                value = px[x, y]
                if value < 250:
                    weight = (255 - value) / 255.0
                    ink += weight
                    sum_x += x * weight
                    sum_y += y * weight
                    if x < min_x:
                        min_x = x
                    if x > max_x:
                        max_x = x
                    if y < min_y:
                        min_y = y
                    if y > max_y:
                        max_y = y
        stats[label] = {
            'coverage': ink / total,
            'centroid_y': (sum_y / ink) if ink else 0,
            'bbox_w': (max_x - min_x + 1) / SCALE,
            'bbox_h': (max_y - min_y + 1) / SCALE,
            'left': min_x / SCALE,
            'right': (max_x + 1) / SCALE,
        }
    return stats


def main():
    if len(sys.argv) > 1:
        img = Image.open(sys.argv[1]).convert('L')
        source = 'image'
    else:
        img = render_with_browser()
        if img is not None:
            source = 'browser'
        else:
            # CI 环境回退：内置光栅化
            top = rasterize_locally('IconSparkle')
            bottom = rasterize_locally('IconUndo')
            img = Image.new('L', (top.width, top.height * 2), 255)
            img.paste(top, (0, 0))
            img.paste(bottom, (0, top.height))
            source = 'builtin-rasterizer'

    stats = analyse(img)
    print('Icon weight at %dpx (source: %s)' % (PX, source))
    print('-' * 72)
    for label in ('sparkle', 'undo'):
        s = stats[label]
        print('%-8s coverage=%.3f  bbox=%.1fx%.1f  left=%.1f right=%.1f  cy=%.2f' % (
            label, s['coverage'], s['bbox_w'], s['bbox_h'], s['left'], s['right'], s['centroid_y']))
    print('-' * 72)

    a, b = stats['sparkle'], stats['undo']
    coverage_ratio = min(a['coverage'], b['coverage']) / max(a['coverage'], b['coverage'])
    cy_delta = abs(a['centroid_y'] - b['centroid_y']) / SCALE
    left_delta = abs(a['left'] - b['left'])
    width_delta = abs(a['right'] - b['right'])

    print('coverage ratio : %.2f   (limit >= 0.55)' % coverage_ratio)
    print('centroid dy    : %.2f px (limit <= 0.6)' % cy_delta)
    print('left edge dx   : %.2f px (limit <= 1.2)' % left_delta)
    print('width delta    : %.2f px (limit <= 2.0)' % width_delta)
    print()
    ok = coverage_ratio >= 0.55 and cy_delta <= 0.6 and left_delta <= 1.2 and width_delta <= 2.0
    print('RESULT:', 'balanced' if ok else 'needs tuning')
    raise SystemExit(0 if ok else 1)


if __name__ == '__main__':
    main()
