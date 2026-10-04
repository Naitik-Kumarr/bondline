#!/usr/bin/env python3
"""Classify scanner candidates without exposing any value or source snippet."""
import json
import re
from pathlib import Path

ROOT = Path('/Users/naitik/surety')
scan = json.loads((ROOT/'audit/evidence/secrets-scan-final.json').read_text())
hexkey = re.compile(r'(?<![A-Za-z0-9])(?:0x)?[A-Fa-f0-9]{64}(?![A-Za-z0-9])')
ctx = re.compile(r'(?:private[_ -]?key|privkey|secret[_ -]?key|wallet[_ -]?key|deployer[_ -]?key)', re.I)
literal = re.compile(r'\b([A-Za-z_][A-Za-z0-9_]*)\s*["\']?\s*[:=]\s*["\']([^"\'\r\n]{12,220})["\']')
secret_name = re.compile(r'API[_-]?KEY|SECRET|AUTH[_-]?TOKEN|ACCESS[_-]?TOKEN|PASSWORD|MNEMONIC', re.I)
vendor_examples = set()
# Compare vendor documentation internally; no dependency source is displayed.
for p in (ROOT/'node_modules/ox').rglob('*'):
    if not p.is_file() or p.suffix not in {'.js', '.ts'}:
        continue
    try:
        data = p.read_text()
    except (OSError, UnicodeDecodeError):
        continue
    for m in hexkey.finditer(data):
        if '@example' in data[max(0, m.start()-1000):m.start()]:
            vendor_examples.add(m.group().lower())

review = []
for item in scan['matches']:
    p = ROOT/item['file']
    data = p.read_text()
    classifications = []
    if item['class'] == 'private-key-literal-candidate':
        for m in hexkey.finditer(data):
            if data.count('\n', 0, m.start())+1 != item['line']:
                continue
            around = data[max(0, m.start()-140):m.end()+60]
            if not ctx.search(around):
                continue
            if '@example' in data[max(0, m.start()-600):m.start()] and m.group().lower() in vendor_examples:
                classifications.append('dependency-documentation-example')
            else:
                classifications.append('unresolved-private-key-candidate')
    elif item['class'] == 'secret-assignment-literal-candidate':
        for m in literal.finditer(data):
            if data.count('\n', 0, m.start())+1 != item['line'] or not secret_name.search(m.group(1)):
                continue
            v = m.group(2)
            if re.fullmatch(r'@(?:appkit|w3m|reown|metamask)/[a-z-]+', v):
                classifications.append('dependency-storage-key-name')
            elif re.search(r'<|>|[,;{}\\]|\s+\w+\s+', v):
                classifications.append('dependency-source-or-html-fragment')
            else:
                classifications.append('unresolved-secret-literal-candidate')
    review.append({'file': item['file'], 'line': item['line'],
                   'classifications': sorted(set(classifications)) or ['unresolved-candidate']})

result = {'candidatesReviewed': len(review),
          'unresolvedCandidates': sum(any('unresolved' in c for c in x['classifications']) for x in review),
          'review': review}
print(json.dumps(result, indent=2))
