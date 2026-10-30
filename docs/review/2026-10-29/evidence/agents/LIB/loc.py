import json,sys
en=json.load(open('locales/en.json')); nl=json.load(open('locales/nl.json'))
def get(d,path):
    for p in path.split('.'):
        if isinstance(d,dict) and p in d: d=d[p]
        else: return None
    return d
for p in sys.argv[1:]:
    print(p, '| EN:', json.dumps(get(en,p),ensure_ascii=False)[:300], '| NL:', json.dumps(get(nl,p),ensure_ascii=False)[:300])
