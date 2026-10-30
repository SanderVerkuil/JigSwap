import json,glob,collections,re,sys
want=sys.argv[1]
by=collections.defaultdict(list)
tot=collections.Counter(); nodes_listed=collections.Counter()
for f in sorted(glob.glob('/tmp/jigswap-review/shots/*/*.json')):
    if 'index' in f: continue
    d=json.load(open(f))
    v=d['variant']; name=d['name']
    for r in d.get('axe') or []:
        if r['id']!=want: continue
        tot[(v,name)]+=r['count']
        for n in r['nodes']:
            by[n['html'][:160]].append((v,name,n['target'],n.get('summary','').replace('\n',' | ')[:300]))
print('per page counts:')
for k,c in sorted(tot.items(), key=lambda x:-x[1]): print('  ',c,k)
print()
for h,lst in sorted(by.items(), key=lambda x:-len(x[1])):
    print(len(lst), h)
    print('    e.g.', lst[0][0], lst[0][1], '|', lst[0][2][:200])
    print('    ', lst[0][3])
