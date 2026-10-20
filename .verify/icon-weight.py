"""
在真实的 16px 尺寸下比较两个工具栏图标的视觉重量（墨水覆盖率与视觉重心）。

用无头浏览器渲染 SVG 后统计像素：这是唯一可信的度量方式——自己实现的
扫描线填充器在本插件使用的自交路径上会产生伪填充，结论与浏览器不一致，
因此这里坚持用真实渲染。CI 与本机都需要一个 Chromium 内核浏览器；
找不到时脚本明确跳过（exit 0），而不是用一个不可信的光栅化器当门禁。

用法：
    python3 .verify/icon-weight.py            # 自动寻找浏览器
    python3 .verify/icon-weight.py shot.png   # 分析已有截图
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CLIENT = ROOT / 'client.js'
PX = 16
SCALE = 8  # 设备缩放，让抗锯齿统计更准

BROWSERS = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
]


def svg_of(name, px):
    """从 client.js 抽出图标并生成与插件里一致的 SVG 标记。"""
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


def find_browser():
    for path in BROWSERS:
        if os.path.exists(path):
            return path
    for name in ('chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'msedge'):
        found = shutil.which(name)
        if found:
            return found
    return None


def render_with_browser(browser):
    """把两个图标各渲染到 16px 宽的一行。

    返回 (截图路径, 清理回调)：临时目录必须活到调用方分析完截图之后，
    因此这里不自己删除，而是把清理交给调用方。
    """
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

    def cleanup():
        shutil.rmtree(work, ignore_errors=True)

    try:
        subprocess.run(
            [browser, '--headless=new', '--disable-gpu', '--hide-scrollbars',
             '--force-device-scale-factor=%d' % SCALE,
             '--screenshot=%s' % shot, '--window-size=%d,%d' % (PX, PX * 2),
             'file:///%s' % page.as_posix()],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90,
        )
    except Exception:
        cleanup()
        return None, None
    if not shot.exists():
        cleanup()
        return None, None
    return shot, cleanup


def analyse(shot_path):
    from PIL import Image

    img = Image.open(shot_path).convert('L')
    width, height = img.size
    cell_h = height // 2
    stats = {}
    for label, top in (('sparkle', 0), ('undo', cell_h)):
        crop = img.crop((0, top, width, top + cell_h))
        px = crop.load()
        w, h = crop.size
        total = w * h
        ink = 0.0
        sum_y = 0.0
        min_x, min_y, max_x, max_y = w, h, 0, 0
        for y in range(h):
            for x in range(w):
                value = px[x, y]
                if value < 250:
                    weight = (255 - value) / 255.0
                    ink += weight
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
    cleanup = None
    if len(sys.argv) > 1:
        shot = Path(sys.argv[1])
        source = 'image'
    else:
        browser = find_browser()
        if not browser:
            # 没有可信渲染器就不做判断：一个不可靠的度量不该拦住合并。
            print('SKIP: no Chromium-based browser found; icon balance not verified')
            raise SystemExit(0)
        shot, cleanup = render_with_browser(browser)
        if shot is None:
            print('SKIP: headless render produced no screenshot')
            raise SystemExit(0)
        source = Path(browser).name

    try:
        try:
            stats = analyse(shot)
        except ImportError:
            print('SKIP: Pillow is not installed; run `pip install pillow` to verify icon balance')
            raise SystemExit(0)
    finally:
        # 分析完成后才清理临时截图目录
        if cleanup is not None:
            cleanup()

    print('Icon weight at %dpx (rendered by: %s)' % (PX, source))
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
