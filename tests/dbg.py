from playwright.sync_api import sync_playwright
url = 'file:///home/claude/lumen-garden/dist/index.html'
PROJ = open('tests/play.py').read().split('PROJ = """')[1].split('"""')[0]
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800})
    pg.goto(url); pg.wait_for_timeout(400); pg.click('#btn-flat'); pg.wait_for_timeout(300); pg.evaluate("game.start('daily',0)"); pg.wait_for_timeout(300)
    info = pg.evaluate("(() => { const n = Puzzle.nearestSolution(game.lv); return {mode: game.mode, rows: Puzzle.toRows(game.lv), sol: n.solution, cur: Puzzle.currentOrients(game.lv), ms: game.lv.mirrors.map(m=>[m.x,m.y])}; })()")
    print(info)
    for i, (s, c) in enumerate(zip(info['sol'], info['cur'])):
        if s != c:
            x, y = info['ms'][i]
            sx, sy = pg.evaluate(PROJ + f"([{x},{y},0.03])")
            pg.mouse.move(sx, sy); pg.wait_for_timeout(60)
            h = pg.evaluate("JSON.stringify(game.pointers.mouse && game.pointers.mouse.hit)")
            print('want', i, 'hover', h)
    b.close()
