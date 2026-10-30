import json,glob,collections,re,sys
rules=collections.defaultdict(lambda: collections.Counter())
rule_routes=collections.defaultdict(set)
samples=collections.defaultdict(dict)
for f in glob.glob('/tmp/jigswap-review/shots/*/*.json'):
    if 'index' in f: continue
    d=json.load(open(f))
    v=d['variant']; name=d['name']
    for r in d.get('axe') or []:
        for n in r.get('nodes',[]):
            html=n.get('html','')
            # key by simplified html: tag + class
            m=re.match(r'<(\w+)([^>]*)>',html)
            tag=m.group(1) if m else '?'
            cls=re.search(r'class="([^"]*)"',html)
            key=(tag, (cls.group(1) if cls else '')[:140])
            rules[r['id']][key]+=1
            rule_routes[(r['id'],key)].add(f"{v}/{name}")
            if key not in samples[r['id']]:
                samples[r['id']][key]=(n.get('target'), html[:300], n.get('summary','')[:400])
want=sys.argv[1]
top=int(sys.argv[2]) if len(sys.argv)>2 else 30
for key,c in rules[want].most_common(top):
    t,h,s=samples[want][key]
    print(c, key)
    print('   target:',t)
    print('   html:',h)
    print('   summ:',s.replace('\n',' | '))
    rr=sorted(rule_routes[(want,key)])
    print('   routes(%d):'%len(rr), rr[:6])
