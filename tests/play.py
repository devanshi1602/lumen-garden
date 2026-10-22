from playwright.sync_api import sync_playwright
url = 'file:///home/claude/lumen-garden/dist/index.html'
out = '/home/claude/lumen-garden/tests/shots/'
PROJ = """(([x,y,h]) => { const g = game, wp = g._world(x, y, h);
  const vp = M3.mul(g.proj, g.view); const c = [0,1,2,3].map(r => vp[r]*wp[0]+vp[4+r]*wp[1]+vp[8+r]*wp[2]+vp[12+r]);
  const rect = g.canvas.getBoundingClientRect();
  return [rect.left + (c[0]/c[3]*0.5+0.5)*rect.width, rect.top + (0.5-c[1]/c[3]*0.5)*rect.height]; })"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800})
    errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(url); pg.wait_for_timeout(500); pg.click('#btn-flat'); pg.wait_for_timeout(400)
    for step in range(8):
        info = pg.evaluate("(() => { const n = Puzzle.nearestSolution(game.lv); return {mode: game.mode, idx: game.idx, name: game.lv.name, sol: n.solution, cur: Puzzle.currentOrients(game.lv), ms: game.lv.mirrors.map(m=>[m.x,m.y])}; })()")
        for i, (s, c) in enumerate(zip(info['sol'], info['cur'])):
            if s != c:
                x, y = info['ms'][i]
                sx, sy = pg.evaluate(PROJ + f"([{x},{y},0.03])")
                pg.mouse.move(sx, sy); pg.wait_for_timeout(60); pg.mouse.down(); pg.mouse.up(); pg.wait_for_timeout(120)
        pg.wait_for_timeout(1300)
        st = pg.evaluate("({won: game.won, taps: game.taps, prog: game.progress})")
        print(info['mode'], info['idx'], info['name'], 'won' if st['won'] else 'NOT WON', 'taps', st['taps'])
        if step in (2, 3, 5): pg.screenshot(path=out + f'win_{step}.png')
        if not st['won']: pg.screenshot(path=out + f'fail_{step}.png'); break
        # press Next on the panel via mouse: project panel 'next' button centre
        nx, ny = pg.evaluate("""(() => { const g = game, b = g.buttons.find(b => b.id === 'next'); const u = (b.x + b.w/2)/1024 - 0.5, v = 0.5 - (b.y + b.h/2)/512;
           const wp = M3.point(g.boardMat, M3.point(g.panelLocal, [u, v, 0])); const vp = M3.mul(g.proj, g.view);
           const c = [0,1,2,3].map(r => vp[r]*wp[0]+vp[4+r]*wp[1]+vp[8+r]*wp[2]+vp[12+r]); const rect = g.canvas.getBoundingClientRect();
           return [rect.left + (c[0]/c[3]*0.5+0.5)*rect.width, rect.top + (0.5-c[1]/c[3]*0.5)*rect.height]; })()""")
        pg.mouse.move(nx, ny); pg.wait_for_timeout(60); pg.mouse.down(); pg.mouse.up(); pg.wait_for_timeout(500)
    pg.screenshot(path=out + 'after.png')
    # reload → resume test
    pg.reload(); pg.wait_for_timeout(600)
    print('after reload', pg.evaluate("({mode: game.mode, idx: game.idx, prog: game.progress})"))
    print('ERRORS', errs)
    b.close()
