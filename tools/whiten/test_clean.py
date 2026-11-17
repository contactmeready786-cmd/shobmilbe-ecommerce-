import os, sys, numpy as np
sys.path.insert(0, 'os.path.dirname(os.path.abspath(__file__))')
import cloud
S = cloud.S
def M(): return np.zeros((S, S), np.float32)
def box(m, y0, y1, x0, x1): m[y0:y1, x0:x1] = 1; return m
def kept(m, r, y, x): return r[y, x] > 0.5
ok = True
def check(name, cond):
    global ok; print(('PASS ' if cond else 'FAIL ') + name); ok &= bool(cond)
# 1 capacitor body + two detached legs below
m = box(M(), 300, 600, 400, 600); box(m, 620, 950, 440, 450); box(m, 620, 950, 550, 560)
r = cloud.clean_pieces(m)
check('legs kept', kept(m, r, 800, 445) and kept(m, r, 800, 555))
# 2 five capacitors incl. corners / bottom
m = M()
for (y, x) in [(450, 450), (50, 50), (50, 850), (850, 50), (850, 850)]: box(m, y, y + 120, x, x + 100)
r = cloud.clean_pieces(m)
check('five items kept', all(kept(m, r, y + 50, x + 50) for (y, x) in [(450, 450), (50, 50), (50, 850), (850, 50), (850, 850)]))
# 3 tall thin capacitor alone + tiny far dust
m = box(M(), 100, 950, 500, 540); box(m, 20, 24, 20, 24)
r = cloud.clean_pieces(m)
check('thin capacitor kept', kept(m, r, 500, 520))
# 4 small logo in a far corner, no text info -> removed (small, far, edge)
m = box(M(), 300, 700, 300, 700); box(m, 20, 60, 900, 1000)
r = cloud.clean_pieces(m)
check('corner logo removed', not kept(m, r, 40, 950) and kept(m, r, 500, 500))
# 5 text pieces under product, OCR box covers them
m = box(M(), 200, 600, 300, 700)
for x in (320, 400, 480): box(m, 700, 730, x, x + 50)
r = cloud.clean_pieces(m, [(310, 690, 560, 740)])
check('text under product removed', not kept(m, r, 715, 340) and kept(m, r, 400, 500))
# 6 big text badge at top-left corner (40% of product), OCR covers it
m = box(M(), 400, 800, 300, 700); box(m, 20, 200, 20, 300)
r = cloud.clean_pieces(m, [(15, 15, 305, 205)])
check('big text badge removed', not kept(m, r, 100, 100) and kept(m, r, 600, 500))
# 7 product label printed on the product itself must stay
m = box(M(), 300, 700, 300, 700)
r = cloud.clean_pieces(m, [(400, 450, 600, 500)])
check('product with print kept', kept(m, r, 475, 500))
# 8 safety: if cleaning would remove > 20% -> unchanged
m = box(M(), 400, 600, 400, 600); box(m, 0, 150, 0, 30); box(m, 870, 1024, 994, 1024)
r = cloud.clean_pieces(m)
print('safety case kept-all:', bool(kept(m, r, 50, 10)))
sys.exit(0 if ok else 1)
