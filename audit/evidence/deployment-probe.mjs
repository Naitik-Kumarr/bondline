import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, http, encodeFunctionData, decodeFunctionResult, keccak256, encodeAbiParameters } from 'viem';

// Public read-only RPC only. Does not import configuration that reads .env or hold a wallet client.
const root = '/Users/naitik/surety';
const rpc = 'https://rpc.testnet.chain.robinhood.com';
const deployment = JSON.parse(fs.readFileSync(path.join(root, 'deployments/rhTestnet.json'), 'utf8'));
const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 2 }) });
const block = await client.getBlock();
const blockNumber = block.number;
const result = { command: 'node audit/evidence/deployment-probe.mjs', rpc, queriedAt: new Date().toISOString(), chainId: await client.getChainId(), block: { number: blockNumber.toString(), hash: block.hash, timestamp: Number(block.timestamp) }, contracts: [], tokens: {}, wallets: {}, markets: {}, notes: [] };
const artifactsRoot = process.argv[2] || 'contracts/out';
function artifact(name) { return JSON.parse(fs.readFileSync(path.join(root, artifactsRoot, `${name}.sol`, `${name}.json`), 'utf8')); }
const art = Object.fromEntries(['BondlineMarket', 'BondlineCover', 'AgentAccount', 'OracleVenue', 'MirrorFeed', 'ProofOfCover'].map(n => [n, artifact(n)]));
function norm(value, refs) {
  let b = Buffer.from(value.replace(/^0x/, ''), 'hex');
  for (const rs of Object.values(refs || {})) for (const r of rs) b.fill(0, r.start, r.start + r.length);
  return '0x' + b.toString('hex');
}
function noMetadata(value) { const b = Buffer.from(value.slice(2), 'hex'); const n = b.readUInt16BE(b.length - 2); return '0x' + b.subarray(0, b.length - n - 2).toString('hex'); }
async function read(address, abi, functionName, args = []) {
  try { return await client.readContract({ address, abi, functionName, args, blockNumber }); }
  catch (e) { return { error: String(e.shortMessage || e.message).slice(0, 350) }; }
}
const slots = Object.fromEntries(['implementation','admin','beacon'].map(n=>[n,'0x'+(BigInt(keccak256(new TextEncoder().encode(`eip1967.proxy.${n}`)))-1n).toString(16).padStart(64,'0')]));
const rows = [
  ['cover implementation', 'BondlineCover', deployment.implementations.cover],
  ['account implementation', 'AgentAccount', deployment.implementations.account],
  ...['live', 'replay'].flatMap(k => [[`${k} market`, 'BondlineMarket', deployment.markets[k].address], [`${k} venue`, 'OracleVenue', deployment.markets[k].venue], ...Object.entries(deployment.markets[k].feeds).map(([s,a]) => [`${k} ${s} feed`, 'MirrorFeed', a])]),
  ['proof of cover', 'ProofOfCover', deployment.proofOfCover.address]
];
for (const [role, type, address] of rows) {
  const code = await client.getBytecode({ address, blockNumber });
  const local = art[type].deployedBytecode.object;
  const refs = art[type].deployedBytecode.immutableReferences;
  const actualNorm = norm(code, refs), expectedNorm = norm(local, refs);
  const row = { role, type, address, bytes: (code.length-2)/2, codeHash: keccak256(code), artifact: `${artifactsRoot}/${type}.sol/${type}.json`, artifactRuntimeHash: keccak256(local), immutableMaskedMatch: actualNorm === expectedNorm, executableMaskedMatch: noMetadata(actualNorm) === noMetadata(expectedNorm), immutableValues: {}, eip1967: {}, abiFunctions: art[type].abi.filter(x=>x.type==='function').map(x=>x.name) };
  for (const [id, rs] of Object.entries(refs || {})) row.immutableValues[id] = rs.map(r => code.slice(2+r.start*2,2+(r.start+r.length)*2));
  for (const [name, slot] of Object.entries(slots)) row.eip1967[name] = await client.getStorageAt({ address, slot, blockNumber });
  if (type === 'MirrorFeed') row.getters = { keeper: await read(address, art[type].abi, 'keeper'), decimals: await read(address, art[type].abi, 'decimals'), description: await read(address, art[type].abi, 'description'), latestRoundData: await read(address, art[type].abi, 'latestRoundData') };
  result.contracts.push(row);
}
const tokenAbi = ['name', 'symbol', 'decimals', 'DOMAIN_SEPARATOR', 'paused', 'balanceOf', 'isFrozen', 'owner'].map(name => ({ type: 'function', name, stateMutability: 'view', inputs: ['balanceOf','isFrozen'].includes(name) ? [{ type:'address', name:'account' }] : [], outputs:[{ type: name==='name'||name==='symbol'?'string':name==='decimals'?'uint8':name==='DOMAIN_SEPARATOR'?'bytes32':name==='paused'||name==='isFrozen'?'bool':name==='owner'?'address':'uint256' }] }));
for (const [label,address] of Object.entries({ USDG: deployment.usdg, ...deployment.assets })) {
  result.tokens[label] = { address, codeHash: keccak256(await client.getBytecode({ address, blockNumber })), name: await read(address, tokenAbi, 'name'), symbol: await read(address, tokenAbi, 'symbol'), decimals: await read(address, tokenAbi, 'decimals') };
  if (label === 'USDG') { result.tokens[label].domain = await read(address, tokenAbi, 'DOMAIN_SEPARATOR'); result.tokens[label].paused = await read(address, tokenAbi, 'paused'); }
}
for (const [k,d] of Object.entries(deployment.markets)) {
  const abi = art.BondlineMarket.abi;
  const m = { address: d.address, venue: d.venue, config: {}, offers: [] };
  m.usdgBalance = await read(deployment.usdg, tokenAbi, 'balanceOf', [d.address]);
  for (const n of ['usdg','venue','coverImplementation','accountImplementation','maxPriceAge','label','assets','feeds','capBps','offerCount']) m.config[n] = await read(d.address, abi, n);
  m.venueConfig = {};
  for (const n of ['market','usdg','spreadBps','maxPriceAge']) m.venueConfig[n] = await read(d.venue, art.OracleVenue.abi, n);
  m.venueBalances = {};
  for (const [t,a] of Object.entries({USDG:deployment.usdg,...deployment.assets})) m.venueBalances[t] = await read(a, tokenAbi, 'balanceOf', [d.venue]);
  const offers = await read(d.address, abi, 'offers');
  if (!offers.error) for (const o of offers) {
    const v = { terms: o, book: {}, actualUSDG: await read(deployment.usdg, tokenAbi, 'balanceOf', [o.cover]) };
    const a = art.BondlineCover.abi;
    for (const n of ['market','usdg','underwriter','agent','accountImplementation','bond','reserved','free','premiums','claimsPaid','accountCount','listed','terms','maxPriceAge']) v.book[n] = await read(o.cover,a,n);
    v.book.accounts = [];
    for (let i=0n; i<BigInt(v.book.accountCount); i++) v.book.accounts.push(await read(o.cover,a,'accountAt',[i]));
    v.bytecode = await client.getBytecode({ address:o.cover, blockNumber });
    v.accounts = [];
    if (Array.isArray(v.book.accounts)) for (const account of v.book.accounts) {
      const x = { address: account, bytecode: await client.getBytecode({ address:account, blockNumber }), position: await read(o.cover,a,'position',[account]), getters:{}, balances:{} };
      for (const n of ['owner','agent','cover','market','paused','stopped','released','rules','assets','feeds','valuation']) x.getters[n] = await read(account,art.AgentAccount.abi,n);
      for (const [t,address] of Object.entries({USDG:deployment.usdg,...deployment.assets})) x.balances[t] = await read(address,tokenAbi,'balanceOf',[account]);
      v.accounts.push(x);
    }
    m.offers.push(v);
  } else m.offersError = offers;
  result.markets[k] = m;
}
for (const [role,address] of Object.entries(deployment.wallets)) result.wallets[role] = { address, code: await client.getBytecode({ address, blockNumber }), nativeBalance: await client.getBalance({ address, blockNumber }), USDG: await read(deployment.usdg,tokenAbi,'balanceOf',[address]), frozen: await read(deployment.usdg,tokenAbi,'isFrozen',[address]) };
result.proofOfCover = {};
for (const n of ['liveMarket','replayMarket']) result.proofOfCover[n] = await read(deployment.proofOfCover.address,art.ProofOfCover.abi,n);
const json = JSON.stringify(result, (_,v)=>typeof v==='bigint'?v.toString():v, 2);
const out = path.join(root,'audit/evidence/deployment-snapshot.json');
fs.writeFileSync(out, json+'\n');
console.log(JSON.stringify({ file:out, block:result.block, chainId:result.chainId, matches:result.contracts.map(r=>({role:r.role, immutableMaskedMatch:r.immutableMaskedMatch, executableMaskedMatch:r.executableMaskedMatch})), marketCount:Object.keys(result.markets).length },null,2));
