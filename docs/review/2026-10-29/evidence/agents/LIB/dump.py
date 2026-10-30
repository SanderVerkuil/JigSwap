import json,sys
for path in sys.argv[1:]:
  d=json.load(open(path))
  m=d['metrics']
  print('=====',path, 'final=',d['finalUrl'])
  for k in m:
    if k in ('title','lang'): continue
    v=m[k]
    s=json.dumps(v, ensure_ascii=False)
    print('  ',k,':', s[:900])
  print('  consoleErrors:', json.dumps(d.get('consoleErrors'))[:800])
  ax=d.get('axe') or {}
  if isinstance(ax, dict) and 'violations' in ax:
    vs=ax['violations']
  else:
    vs=ax
  if isinstance(vs, list):
    for v in vs:
      print('  AXE', v.get('id'), v.get('impact'), len(v.get('nodes',[])))
      for n in v.get('nodes',[])[:6]:
        print('     -', json.dumps(n.get('target'))[:150], '|', (n.get('failureSummary') or '')[:200].replace('\n',' '))
  else:
    print('  AXE raw', json.dumps(ax)[:500])
