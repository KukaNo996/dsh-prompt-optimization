"""
在真实 16px 尺寸下比较两个工具栏图标的视觉重量（墨水覆盖率与视觉重心）。
先由无头浏览器渲染，再统计像素。

用法：node .verify/icon-weight.mjs   （Node 负责截图，随后调用本脚本统计）
或   python3 .verify/icon-weight.py  （已有截图时直接统计）
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CLIENT = ROOT / 'client.js'
PX = 16
SCALE = 8  # device scale factor，用于抗锯齿统计
BROWSERS = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
]


def svg_of(name, px):
    import re
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


def render():
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
        return shot if shot.exists() else None
    finally:
        pass


def analyse(shot_path):
    img = Image.open(shot_path).convert('L')
    width, height = img.size
    cell_h = height // 2
    stats = {}
    for label, top in (('sparkle', 0), ('undo', cell_h)):
        crop = img.crop((0, top, width, top + cell_h))
        px = crop.load()
        w, h = crop.size
        total = w * h
        ink = 0
        sum_x = 0
        sum_y = 0
        min_x, min_y, max_x, max_y = w, h, 0, 0
        for y in range(h):
            for x in range(w):
                value = px[x, y]
                if value < 250:  # 有墨
                    weight = (255 - value) / 255.0
                    ink += weight
                    sum_x += x * weight
                    sum_y += y * weight
                    min_x = min(min_x, x)
                    min_y = min(min_y, y)
                    max_x = max(max_x, x)
                    max_y = max(max_y, y)
        stats[label] = {
            'coverage': ink / total,
            'centroid_x': (sum_x / ink) if ink else 0,
            'centroid_y': (sum_y / ink) if ink else 0,
            'bbox_w': (max_x - min_x + 1) / SCALE,
            'bbox_h': (max_y - min_y + 1) / SCALE,
            'left': min_x / SCALE,
            'right': (max_x + 1) / SCALE,
        }
    return stats


def main():
    if len(sys.argv) > 1:
        shot = Path(sys.argv[1])
    else:
        shot = render()
        if shot is None:
            print('SKIP: no local browser found')
            raise SystemExit(2)

    stats = analyse(shot)
    print('Icon weight at %dpx (measured from real browser render)' % PX)
    print('-' * 72)
    for label in ('sparkle', 'undo'):
        s = stats[label]
        print('%-8s coverage=%.3f  bbox=%.1fx%.1f  left=%.1f right=%.1f  cy=%.2f' % (
            label, s['coverage'], s['bbox_w'], s['bbox_h'], s['left'], s['right'], s['centroid_y']))
    print('-' * 72)

    a = stats['sparkle']
    b = stats['undo']
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
