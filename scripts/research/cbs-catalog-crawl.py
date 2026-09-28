# Research tool (session 138, breadth spec step 1): metadata-only crawl of every current CBS table.
# Input: allids.json (current table ids from cbs_catalog where status=Regulier). Output: crawl.jsonl.
# Run: python3 scripts/research/cbs-catalog-crawl.py  (network; no observations fetched; ~20 min at 6 threads)
# Metadata-only crawl of every current CBS table (no observations). Writes crawl.jsonl.
import json,urllib.request,concurrent.futures as cf,time,os
ids=json.load(open('allids.json')); B='https://datasets.cbs.nl/odata/v1/CBS'
done=set()
if os.path.exists('crawl.jsonl'):
  for l in open('crawl.jsonl'): done.add(json.loads(l)['id'])
def j(u):
  for a in range(3):
    try: return json.load(urllib.request.urlopen(u,timeout=90))
    except Exception as e:
      err=e; time.sleep(2*(a+1))
  raise err
def get(t):
  r={'id':t}
  try:
    p=j(f'{B}/{t}/Properties'); r['obs']=p.get('ObservationCount'); r['title']=p.get('Title')
    r['dims']=[]
    for d in j(f'{B}/{t}/Dimensions')['value']:
      c=j(f"{B}/{t}/{d['Identifier']}Codes")['value']
      e={'id':d['Identifier'],'kind':d['Kind'],'n':len(c)}
      if d['Kind']=='TimeDimension':
        e['status_null']=sum(1 for m in c if m.get('Status') is None); e['grains']=sorted({m['Identifier'][4:6] for m in c})
      else:
        e['members']=[(m['Identifier'].strip(),m['Title']) for m in c[:400]]
      r['dims'].append(e)
    mc=j(f'{B}/{t}/MeasureCodes')['value']; r['measures']=len(mc); r['units']=sorted({m.get('Unit') or '' for m in mc})
  except Exception as ex: r['err']=str(ex)[:80]
  return r
todo=[t for t in ids if t not in done]
with open('crawl.jsonl','a') as f, cf.ThreadPoolExecutor(2) as ex:
  for i,r in enumerate(ex.map(get,todo)):
    f.write(json.dumps(r,ensure_ascii=False)+'\n'); f.flush()
    if i%100==0: print(i,len(todo),flush=True)
print('DONE')
