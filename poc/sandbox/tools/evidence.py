import json, sys
d = json.load(open(sys.argv[1]))
def walk(s):
    for sp in s.get('specs', []):
        for t in sp['tests']:
            r = t['results'][-1] if t['results'] else {}
            print(f"[{t['projectName']}] {sp['title']} -> {r.get('status')}")
            if r.get('error'): print('  ERROR', r['error'].get('message','')[:400])
            for a in t.get('annotations', []):
                print('  ', a['description'][:int(sys.argv[2]) if len(sys.argv) > 2 else 1500])
    for c in s.get('suites', []): walk(c)
for s in d['suites']: walk(s)
