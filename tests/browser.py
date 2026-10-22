import sys, json
from playwright.sync_api import sync_playwright
url = 'file:///home/claude/lumen-garden/dist/index.html'
out = '/home/claude/lumen-garden/tests/shots/'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800})
    errs = []
    pg.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)))
    pg.goto(url); pg.wait_for_timeout(1200)
    pg.screenshot(path=out + '0_landing.png')
    pg.click('#btn-flat'); pg.wait_for_timeout(800)
    pg.screenshot(path=out + '1_level1.png')
    print(pg.evaluate("JSON.stringify({mode: game.mode, idx: game.idx, solved: game.sim.solved, mirrors: game.lv.mirrors.length})"))
    print('ERRORS', errs)
    b.close()
