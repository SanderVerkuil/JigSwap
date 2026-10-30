import json, sys

SKIP = {'title', 'lang', 'h1', 'pageHeight', 'interactiveCount'}
for v in sys.argv[2:]:
    try:
        d = json.load(open(f'/tmp/jigswap-review/shots/{v}/{sys.argv[1]}.json'))
    except Exception as e:
        print(v, 'ERR', e)
        continue
    m = d['metrics']
    print('=====', v, d['finalUrl'], 'scrollsInner', d.get('scrollsInnerRegion'))
    for k, val in m.items():
        if k in SKIP:
            continue
        print(' ', k, ':', json.dumps(val, ensure_ascii=False)[:2500])
    ax = d.get('axe')
    if ax:
        vs = ax.get('violations', ax) if isinstance(ax, dict) else ax
        for vi in vs:
            print('  AXE', vi.get('id'), vi.get('impact'), len(vi.get('nodes', [])))
            for n in vi.get('nodes', [])[:8]:
                print('     -', json.dumps(n.get('target'))[:200], '|',
                      (n.get('summary') or n.get('html') or '')[:260] + ' || ' + (n.get('html') or '')[:160].replace('\n', ' '))
    print('  console:', [c[:120] for c in d.get('consoleErrors', [])])
