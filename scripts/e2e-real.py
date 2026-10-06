# Browser walkthrough against the REAL server (needs: pip install playwright && playwright install chromium).
# Start it first: ION_OWNER_TOKEN='my-secret-token-0123456789' PORT=8791 node backend/server/server.mjs  (inside a deployed .uapp)
# Then: python3 scripts/e2e-real.py
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 420, 'height': 820}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and '401' not in m.text else None)
    pg.goto('http://127.0.0.1:8791/'); pg.wait_for_selector('#tok')
    print('1 login page shown')
    pg.fill('#tok', 'wrong-token-zzzzzzzzzz'); pg.click('button[type=submit]'); pg.wait_for_timeout(400)
    print('2 wrong token ->', pg.locator('p.error').inner_text())
    pg.fill('#tok', 'my-secret-token-0123456789'); pg.click('button[type=submit]'); pg.wait_for_timeout(600)
    pg.evaluate("location.hash='/students'"); pg.wait_for_timeout(500)
    print('3 empty state:', pg.locator('.empty').count(), '|', pg.locator('.empty p').first.inner_text() if pg.locator('.empty').count() else '-')
    pg.evaluate("location.hash='/students/new'"); pg.wait_for_timeout(400)
    pg.fill('#fld_name', 'Ada'); pg.fill('#fld_email', 'ada@x.org'); pg.fill('#fld_gpa', '3.8')
    pg.locator('form button[type=submit]').click(); pg.wait_for_timeout(700)
    print('4 created ->', pg.evaluate('location.hash'), '|', pg.inner_text('main')[:60].replace('\n', ' | '))
    sid = pg.evaluate('location.hash').split('/')[-1]
    pg.evaluate("location.hash='/courses/new'"); pg.wait_for_timeout(400)
    pg.fill('#fld_name', 'Algorithms'); pg.fill('#fld_code', 'CS301'); pg.fill('#fld_credits', '4')
    pg.locator('form .actions button:has-text("التالي")').click(); pg.wait_for_timeout(100)
    pg.locator('form .actions button:has-text("التالي")').click(); pg.wait_for_timeout(100)
    pg.locator('form .actions button[type=submit]').click(); pg.wait_for_timeout(800)
    cid = pg.evaluate('location.hash').split('/')[-1]
    print('5 wizard saved course ->', pg.evaluate('location.hash'))
    r = pg.evaluate("""async ([sid,cid]) => { const x = await fetch('/api/students/'+sid+'/enrollments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({toId:cid,grade:91})}); return x.status }""", [sid, cid])
    print('6 enroll via API with session cookie ->', r)
    pg.evaluate("location.hash='/students/%s'" % sid); pg.wait_for_timeout(700)
    body = pg.inner_text('main')
    print('7 detail shows notification + course:', 'You are enrolled' in body, '| Algorithms' in body or 'Algorithms' in body)
    pg.screenshot(path='/tmp/real_detail.png')
    pg.evaluate("location.hash='/courses/%s'" % cid); pg.wait_for_timeout(600)
    print('8 course enrolled_count visible:', '1' in pg.inner_text('main'))
    print('ERRORS:', errs); b.close()
