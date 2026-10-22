from playwright.sync_api import sync_playwright
url = 'file:///home/claude/lumen-garden/dist/index.html'
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800})
    errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.add_init_script(path='/home/claude/lumen-garden/tests/xrmock.js')
    pg.goto(url); pg.wait_for_timeout(500)
    print('buttons visible:', pg.is_visible('#btn-ar'), pg.is_visible('#btn-vr'))
    for mode_btn in ['#btn-vr', '#btn-ar']:
        pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_timeout(400)
        pg.click(mode_btn); pg.wait_for_timeout(300)
        pg.evaluate("__xr.step(3)")
        print(mode_btn, 'xr mode:', pg.evaluate("game.xr && game.xr.mode"), 'board', pg.evaluate("game.board.pos.map(v=>+v.toFixed(3))"))
        # POKE: move right index tip from above the mirror down into it
        r = pg.evaluate("""(() => { const m = game.lv.mirrors[0], top = game._world(m.x, m.y, 0.12), mid = game._world(m.x, m.y, 0.03);
            __xr.hands.right.pos['index-finger-tip'] = top; __xr.step(3);
            __xr.hands.right.pos['index-finger-tip'] = mid; __xr.step(3);
            const o = game.lv.mirrors[0].o; __xr.step(3);  // staying inside must not re-trigger
            const o2 = game.lv.mirrors[0].o; __xr.hands.right.pos['index-finger-tip'] = top; __xr.step(2);
            return {taps: game.taps, sameWhileInside: o === o2, won: game.won}; })()""")
        print('  poke ->', r)
        # Pinch-ray: aim left hand ray at the Next button and fire select
        r = pg.evaluate("""(() => { const b = game.buttons.find(b => b.id === 'next'); if (!b) return 'no next button';
            const u = (b.x + b.w/2)/1024 - 0.5, v = 0.5 - (b.y + b.h/2)/512;
            const target = M3.point(game.boardMat, M3.point(game.panelLocal, [u, v, 0]));
            __xr.ray.left = M3.invert(M3.lookAt([-0.15, -0.2, -0.05], target, [0,1,0])); __xr.hands.left.pos['index-finger-tip'] = [-0.15,-0.2,-0.05];
            __xr.step(2); const hit = game.pointers['left-hand'].hit; __xr.fire('select', 'left'); __xr.step(2);
            return {hit: hit && hit.type + ':' + (hit.button && hit.button.id), nowLevel: game.idx, name: game.lv.name}; })()""")
        print('  ray select Next ->', r)
        # ray at a mirror of level 2
        r = pg.evaluate("""(() => { const m = game.lv.mirrors[0], target = game._world(m.x, m.y, 0.03);
            __xr.ray.left = M3.invert(M3.lookAt([-0.15, -0.2, -0.05], target, [0,1,0])); __xr.step(2);
            const before = m.o; __xr.fire('select', 'left'); __xr.step(1); return {flipped: before !== m.o}; })()""")
        print('  ray select mirror ->', r)
        pg.screenshot(path=f'/home/claude/lumen-garden/tests/shots/xr_{mode_btn[5:]}.png')
        pg.evaluate("game.xr.session.end()"); pg.wait_for_timeout(200)
        print('  after end overlay visible:', pg.evaluate("!document.getElementById('overlay').classList.contains('hidden')"))
    print('ERRORS', errs)
    b.close()
