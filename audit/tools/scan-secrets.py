#!/usr/bin/env python3
"""Read-only secret scan. Never reads .env*; emits only file, line, and class.

The output deliberately contains no matched string, snippet, hash, or key.
Binary files, dependencies, generated contract artifacts, and git objects are
excluded. Built web bundles and local logs/private notes are included.
"""
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path('/Users/naitik/surety')
EXCLUDED_DIRS = {'node_modules', 'audit', '.git', '.venv', '__pycache__', 'target'}
records = []
stats = {'files_scanned': 0, 'bytes_scanned': 0, 'env_files_never_opened': 0,
         'binary_files_skipped': 0, 'oversized_files_skipped': 0,
         'contract_generated_or_vendor_files_skipped': 0,
         'client_bundle_files_scanned': 0, 'client_bundle_bytes_scanned': 0}

patterns = [
 ('private-key-pem', re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----')),
 ('aws-access-key-id', re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b')),
 ('openai-api-key', re.compile(r'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b')),
 ('github-token', re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b')),
 ('slack-token', re.compile(r'\bxox[baprs]-[A-Za-z0-9-]{20,}\b')),
 ('google-api-key', re.compile(r'\bAIza[A-Za-z0-9_-]{35}\b')),
 ('stripe-secret-key', re.compile(r'\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b')),
 ('jwt-token', re.compile(r'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b')),
 ('credential-in-url', re.compile(r'(?:https?|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s/:"\']{1,80}:[^\s/@"\']{6,160}@')),
]
hexkey = re.compile(r'(?<![A-Za-z0-9])(?:0x)?[A-Fa-f0-9]{64}(?![A-Za-z0-9])')
key_context = re.compile(r'(?:private[_ -]?key|privkey|secret[_ -]?key|wallet[_ -]?key|deployer[_ -]?key)', re.I)
literal_secret = re.compile(r'\b([A-Za-z_][A-Za-z0-9_]*)\s*["\']?\s*[:=]\s*["\']([^"\'\r\n]{12,220})["\']')
secret_name = re.compile(r'API[_-]?KEY|SECRET|AUTH[_-]?TOKEN|ACCESS[_-]?TOKEN|PASSWORD|MNEMONIC', re.I)
mnemonic = re.compile(r'(?:mnemonic|seed[_ -]?phrase|recovery[_ -]?phrase)\s*["\']?\s*[:=]\s*["\']((?:[a-z]+ ){11,23}[a-z]+)["\']', re.I)
placeholder = re.compile(r'(?:^(?:0x)?[0]+$|placeholder|example|dummy|changeme|your[_ -]|replace[_ -]|redacted|process\.env|import\.meta|env\.|\$\{|\*{4,}|<|^test(?:[_ -]|$)|^development$|^undefined$|^null$|^TODO$)', re.I)
# Anvil public dev keys are distinguishable from deployed private material.
dev_keys = {
 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
 '59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
}

def record(path, data, match, kind):
    records.append({'file': str(path.relative_to(ROOT)), 'line': data.count('\n', 0, match.start()) + 1,
                    'class': kind})

for dirname, dirs, files in os.walk(ROOT, followlinks=False):
    base = Path(dirname)
    dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS and not (base / d).is_symlink()]
    for name in files:
        p = base / name
        rel = p.relative_to(ROOT)
        if sys.argv[1:] and str(rel) not in sys.argv[1:]:
            continue
        if name.startswith('.env'):
            stats['env_files_never_opened'] += 1
            continue
        if p.is_symlink():
            continue
        if rel.parts[0] == 'contracts' and len(rel.parts) > 1 and (rel.parts[1] == 'lib' or rel.parts[1].startswith(('out', 'cache')) or rel.parts[1] == 'broadcast'):
            stats['contract_generated_or_vendor_files_skipped'] += 1
            continue
        try:
            if p.stat().st_size > 35_000_000:
                stats['oversized_files_skipped'] += 1
                continue
            raw = p.read_bytes()
        except (OSError, PermissionError):
            records.append({'file': str(rel), 'line': 0, 'class': 'unreadable-file'})
            continue
        if b'\x00' in raw or raw.startswith((b'\x89PNG', b'\xff\xd8', b'%PDF', b'PK\x03\x04')):
            stats['binary_files_skipped'] += 1
            continue
        try:
            data = raw.decode('utf-8')
        except UnicodeDecodeError:
            stats['binary_files_skipped'] += 1
            continue
        stats['files_scanned'] += 1
        stats['bytes_scanned'] += len(raw)
        if str(rel).startswith('web/') and '/static/' in str(rel) and p.suffix in {'.js', '.json', '.map'}:
            stats['client_bundle_files_scanned'] += 1
            stats['client_bundle_bytes_scanned'] += len(raw)
        for kind, pattern in patterns:
            for m in pattern.finditer(data):
                record(p, data, m, kind)
        for m in hexkey.finditer(data):
            around = data[max(0, m.start()-140):min(len(data), m.end()+60)]
            if not key_context.search(around):
                continue
            value = m.group().removeprefix('0x').lower()
            if value in dev_keys:
                kind = 'public-anvil-test-private-key'
            elif len(set(value)) <= 2 or str(rel).startswith(('contracts/test/', 'contracts/script/')):
                kind = 'test-or-fixture-private-key-candidate'
            else:
                kind = 'private-key-literal-candidate'
            record(p, data, m, kind)
        for m in literal_secret.finditer(data):
            if not secret_name.search(m.group(1)):
                continue
            value = m.group(2)
            if placeholder.search(value) or re.fullmatch(r'[A-Z_][A-Z0-9_]{2,}', value) or re.fullmatch(r'[\w ./:-]+(?:not set|missing|required|only|key|secret|token|password)[\w ./:-]*', value, re.I):
                continue
            if re.fullmatch(r'(?:0x)?[A-Fa-f0-9]{64}', value):
                continue  # handled as a hex key if its context warrants it
            # API names, URLs, low entropy examples and source prose are not keys.
            if len(value.split()) > 3 or value.startswith(('https://', 'http://', './', '../', '/')) or len(set(value)) < 7:
                continue
            record(p, data, m, 'secret-assignment-literal-candidate')
        for m in mnemonic.finditer(data):
            if len(m.group(1).split()) in {12, 15, 18, 21, 24}:
                record(p, data, m, 'mnemonic-literal-candidate')

records = sorted({(x['file'], x['line'], x['class']) for x in records})
print(json.dumps({'stats': stats, 'matches': [{'file': f, 'line': l, 'class': c} for f,l,c in records]}, indent=2))
