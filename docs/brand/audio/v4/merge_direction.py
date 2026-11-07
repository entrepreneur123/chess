"""Write the eleven_v4 prompt of every line (direction.json) into lines.json as `v4`, and the
spoken text (the prompt with its audio tags stripped) as the caption `text`. Fails loudly on any
line that has no direction or any direction that has no line."""
import json, re, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
LINES = HERE.parent / 'lines.json'
d = json.loads((HERE / 'direction.json').read_text(encoding='utf-8'))
data = json.loads(LINES.read_text(encoding='utf-8'))
TAG = re.compile(r'\[[^\]]*\]\s*')
bad = []
for cid, c in data['characters'].items():
    dirs = d.get(cid, {})
    seen = set()
    for l in c['lines']:
        p = dirs.get(l['id'])
        if not p:
            bad.append(f'no direction: {cid}:{l["id"]}'); continue
        seen.add(l['id'])
        l['v4'] = p
        spoken = re.sub(r'\s+', ' ', TAG.sub('', p)).strip()
        l['text'] = spoken
        l.pop('say', None)  # v4 speaks the caption text itself; the old '.' workaround is gone
    for k in dirs:
        if k not in seen: bad.append(f'direction without line: {cid}:{k}')
if bad:
    print('\n'.join(bad)); sys.exit(1)
LINES.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
n = sum(len(c['lines']) for c in data['characters'].values())
print('merged', n, 'lines')
