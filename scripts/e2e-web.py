# Browser check of the generated web app (needs: pip install playwright && playwright install chromium).
# Usage: node src/cli.ts publish examples/mit.json --out out && node src/cli.ts deploy out/university.ion site
#        python3 scripts/e2e-web.py site/university.uapp/web/demo.html
# Walks the ui-advanced behaviour: first-use empty state, 3-step course wizard with validation, review, save.
import sys, pathlib
from playwright.sync_api import sync_playwright
base = pathlib.Path(sys.argv[1]).resolve().as_uri()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 420, 'height': 800}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(base); pg.evaluate("location.hash='/courses/new'"); pg.wait_for_timeout(400)
    note = lambda: pg.locator('form p[role=status]').first.inner_text()
    btns = lambda: {t: pg.locator(f'form .actions button:has-text("{t}")') for t in ['السابق', 'التالي', 'حفظ']}
    B = btns()
    print('1', note(), '| rows:', pg.locator('form .row:visible').count(), '| prev/next/save visible:', B['السابق'].is_visible(), B['التالي'].is_visible(), B['حفظ'].is_visible())
    B['التالي'].click(); pg.wait_for_timeout(100)
    print('2 empty required -> blocked:', note(), '| errors:', pg.locator('form .error:visible').count())
    pg.fill('#fld_name', 'Algorithms'); pg.fill('#fld_code', 'CS301'); pg.fill('#fld_credits', '4')
    B['التالي'].click(); pg.wait_for_timeout(100)
    print('3', note(), '| rows:', pg.locator('form .row:visible').count(), '| prev visible:', B['السابق'].is_visible())
    B['التالي'].click(); pg.wait_for_timeout(100)
    print('4', note(), '| rows visible:', pg.locator('form .row:visible').count(), '| save visible:', B['حفظ'].is_visible(), '| next visible:', B['التالي'].is_visible())
    print('  review:', pg.locator('dl.review').inner_text().replace('\n', ' | ')[:160])
    pg.screenshot(path='/tmp/shot_review.png')
    B['السابق'].click(); pg.wait_for_timeout(100); print('5 back ->', note())
    B['التالي'].click(); pg.wait_for_timeout(100)
    B['حفظ'].click(); pg.wait_for_timeout(500)
    print('6 saved ->', pg.evaluate('location.hash'), '|', pg.inner_text('main')[:80].replace('\n', ' | '))
    # student form (4 fields) must stay a plain form
    pg.evaluate("location.hash='/students/new'"); pg.wait_for_timeout(300)
    print('7 plain form: step note hidden:', not pg.locator('form p[role=status]').first.is_visible(), '| rows:', pg.locator('form .row:visible').count(), '| save visible:', pg.locator('form .actions button[type=submit]').is_visible())
    # list is no longer empty -> plain table, no empty block
    pg.evaluate("location.hash='/courses'"); pg.wait_for_timeout(300)
    print('8 courses list has empty block:', pg.locator('.empty').count(), '| rows:', pg.locator('tbody tr').count())
    print('ERRORS:', errs); b.close()
