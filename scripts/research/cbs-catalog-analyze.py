# Research tool (session 138): analyse crawl.jsonl from cbs-catalog-crawl.py — shapes, totals, period status, units.
import json,re,collections
rs=[json.loads(l) for l in open('crawl.jsonl')]; rs=[r for r in rs if 'err' not in r]; N=len(rs)
def pct(x): return f'{x} ({100*x/N:.0f}%)'
REG=re.compile(r'^(NL|PV|GM|LD|CR|WK|BU)\d')
def total_cands(ms):
  return [m for m in ms if re.match(r'^\s*totaal',m[1],re.I) or m[0].startswith('T00') or re.search(r'[;,]\s*totaal\s*$',m[1],re.I)]
shape=collections.Counter(); status_prose=0; hidden_geo=0; resolvable=0; dimstat=collections.Counter(); special=collections.Counter()
big=0; units=collections.Counter(); grains=collections.Counter(); cells=[]
per_table_ok=[]
for r in rs:
  dims=r['dims']; t=[d for d in dims if d['kind']=='TimeDimension']; g=[d for d in dims if d['kind']=='GeoDimension']
  other=[d for d in dims if d['kind'] not in('TimeDimension','GeoDimension')]
  hg=[d for d in other if d.get('members') and sum(1 for m in d['members'] if REG.match(m[0]))>=0.8*len(d['members'])]
  if hg: hidden_geo+=1
  br=[d for d in other if d not in hg]
  shape['time-only' if not g and not hg and not br else ('region only' if not br else f'{min(len(br),3)}{"+" if len(br)>=3 else ""} breakdown(s)')]+=1
  if t and all(d['status_null']==d['n'] for d in t): status_prose+=1
  for d in t: grains.update(d['grains'])
  ok=True
  for d in br:
    ms=d['members']; tc=total_cands(ms)
    if d['id']=='Marges' or any(m[1].strip().lower()=='waarde' for m in ms): special['Marges/Waarde']+=1; dimstat['convention']+=1; continue
    if len(tc)==1: dimstat['one total']+=1
    elif len(tc)>1: dimstat['several totals']+=1; ok=False
    else: dimstat['no total']+=1; ok=False
    if d['n']>12: dimstat['>12 members']+=1
  per_table_ok.append(ok)
  if ok: resolvable+=1
  if (r.get('obs') or 0)>150000: big+=1
  units.update(u for u in r.get('units',[]))
print('tables measured',N)
for k,v in shape.most_common(): print(' shape',k,pct(v))
print('tables with regions typed as a plain dimension:',pct(hidden_geo))
print('tables with NO machine period status (prose only):',pct(status_prose))
print('breakdown dims:',dict(dimstat), 'special:',dict(special))
print('tables where EVERY breakdown has one total or a convention (answerable without asking):',pct(resolvable))
print('tables >150k cells:',pct(big))
print('grains:',dict(grains))
print('top units:',units.most_common(25))
print('distinct units:',len(units))
