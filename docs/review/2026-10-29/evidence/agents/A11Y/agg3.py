import json,glob,collections,re,sys
# color-contrast: group by fg/bg pair + class signature
by=collections.defaultdict(list)
tot=collections.Counter()
listed=0; total=0
for f in sorted(glob.glob('/tmp/jigswap-review/shots/*/*.json')):
    if 'index' in f: continue
    d=json.load(open(f))
    v=d['variant']; name=d['name']
    for r in d.get('axe') or []:
        if r['id']!='color-contrast': continue
        tot[v]+=r['count']; total+=r['count']
        for n in r['nodes']:
            listed+=1
            s=n.get('summary','')
            m=re.search(r'contrast of ([\d.]+) \(foreground color: (#\w+), background color: (#\w+), font size: ([\d.]+pt)',s)
            cls=re.search(r'class="([^"]*)"',n['html'])
            c=cls.group(1) if cls else n['html'][:80]
            # pick color-ish classes
            cc=' '.join(x for x in c.split() if re.search(r'(text-|bg-|opacity|muted|mk-)',x))
            key=(m.group(2),m.group(3)) if m else ('?','?')
            by[(v.split('-')[1] if '-' in v else v, key, cc[:120])].append((v,name,m.group(1) if m else '?', m.group(4) if m else '', n['html'][:200]))
print('totals per variant',tot,'total',total,'listed nodes',listed)
for k,lst in sorted(by.items(), key=lambda x:-len(x[1]))[:int(sys.argv[1])]:
    names=sorted(set(x[1] for x in lst))
    print(len(lst), k, 'ratio', lst[0][2], lst[0][3])
    print('    ', lst[0][4][:200])
    print('     pages(%d):'%len(names), names[:5])
