/* Read-only supplemental scan. Outputs file:line and class only, never values.
 * .env* files, dependencies, audit, binary/oversized files, and contract vendor
 * artifacts are excluded, consistent with the primary scanner.
 */
const fs = require('node:fs');
const path = require('node:path');
const {validateMnemonic} = require('../../node_modules/@scure/bip39');
const {wordlist} = require('../../node_modules/@scure/bip39/wordlists/english');
const root = '/Users/naitik/surety';
const words = new Set(wordlist);
const publicDocPhrases = new Set();
const ignored = new Set(['node_modules','audit','.git','.venv','__pycache__','target']);
const matches = [];
let scanned = 0;
function report(file, source, index, type) {
  const line = source.slice(0, index).split('\n').length;
  matches.push({file: path.relative(root,file), line, class:type});
}
function scan(file) {
  const rel = path.relative(root,file);
  const parts = rel.split(path.sep);
  if (path.basename(file).startsWith('.env') || (parts[0]==='contracts' && (parts[1]==='lib' || /^(out|cache|broadcast)/.test(parts[1]??'')))) return;
  const stat = fs.statSync(file);
  if (stat.size > 35_000_000) return;
  const raw = fs.readFileSync(file);
  if (raw.includes(0)) return;
  const source = raw.toString('utf8');
  scanned++;
  // Quoted phrases catch seed strings without requiring a variable label.
  for (const m of source.matchAll(/["'`]([a-z]+(?:\s+[a-z]+){11,23})["'`]/g)) {
    const phrase = m[1].trim().replace(/\s+/g,' ');
    const tokens = phrase.split(' ');
    if ([12,15,18,21,24].includes(tokens.length) && tokens.every(w=>words.has(w)) && validateMnemonic(phrase,wordlist)) {
      report(file,source,m.index,publicDocPhrases.has(phrase) ? 'public-dependency-documentation-mnemonic' : 'unresolved-valid-bip39-mnemonic-literal');
    }
  }
  for (const m of source.matchAll(/https?:\/\/[^\s"'`<>\\]{8,500}/g)) {
    let url;
    try {url = new URL(m[0]);} catch {continue;}
    const host=url.hostname.toLowerCase();
    const queryCredential=[...url.searchParams.keys()].some(k=>/^(api[-_]?key|access[-_]?token|secret|password|auth[-_]?token)$/i.test(k));
    const providerCredential = (host.endsWith('alchemy.com') && /^\/v2\/[\w-]{10,}/.test(url.pathname)) ||
      (host.endsWith('infura.io') && /^\/v3\/[\da-f]{32}/i.test(url.pathname)) ||
      (host.endsWith('quiknode.pro') && /\/[\da-f]{20,}/i.test(url.pathname)) ||
      (host.endsWith('chainstack.com') && /\/[\da-f]{20,}/i.test(url.pathname)) ||
      (host==='rpc.ankr.com' && /\/[\da-f]{40,}/i.test(url.pathname));
    if(queryCredential || providerCredential)report(file,source,m.index,'credential-in-rpc-or-api-url-candidate');
  }
}
function walk(folder) {
  for (const entry of fs.readdirSync(folder,{withFileTypes:true})) {
    if(entry.isSymbolicLink())continue;
    const p=path.join(folder,entry.name);
    if(entry.isDirectory()){if(!ignored.has(entry.name))walk(p);}
    else if(entry.isFile())scan(p);
  }
}
// Resolve false positives by internal equality to dependency documentation.
// Public examples are never emitted, even during this classification step.
function collectDocumentation(folder) {
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})) {
    const p=path.join(folder,entry.name);
    if(entry.isDirectory())collectDocumentation(p);
    else if(entry.isFile() && /\.(js|ts)$/.test(entry.name)) {
      const source=fs.readFileSync(p,'utf8');
      for(const comment of source.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
        for(const m of comment[0].matchAll(/["'`]([a-z]+(?:\s+[a-z]+){11,23})["'`]/g)) {
          const phrase=m[1].trim().replace(/\s+/g,' ');
          if(validateMnemonic(phrase,wordlist))publicDocPhrases.add(phrase);
        }
      }
    }
  }
}
collectDocumentation(path.join(root,'node_modules/@scure/bip39'));
collectDocumentation(path.join(root,'node_modules/ox'));
walk(root);
const unique = [...new Map(matches.map(m=>[`${m.file}:${m.line}:${m.class}`,m])).values()];
console.log(JSON.stringify({filesScanned:scanned,matches:unique},null,2));
