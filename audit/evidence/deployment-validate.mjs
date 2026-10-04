import fs from 'node:fs';
import {keccak256,encodeAbiParameters} from 'viem';
const d=JSON.parse(fs.readFileSync('deployments/rhTestnet.json','utf8'));
const s=JSON.parse(fs.readFileSync('audit/evidence/deployment-snapshot.json','utf8'));
const e=JSON.parse(fs.readFileSync('audit/evidence/explorer-snapshot.json','utf8'));
const all={command:'node audit/evidence/deployment-validate.mjs',block:s.block,manifestSharedFileEqual:JSON.stringify(d)===JSON.stringify(JSON.parse(fs.readFileSync('shared/src/deployment.json','utf8'))),contracts:[],markets:{},clones:[],totals:{bond:0n,reserved:0n,principal:0n,premiums:0n,claims:0n,covers:0,active:0},sourceHashes:[]};
function nodes(v,table={}){if(Array.isArray(v)){for(const x of v)nodes(x,table);}else if(v&&typeof v==='object'){if(v.nodeType==='VariableDeclaration')table[v.id]=v.name;for(const x of Object.values(v))if(x&&typeof x==='object')nodes(x,table);}return table;}
for(const row of s.contracts){
  const ex=e.rows.find(x=>x.address.toLowerCase()===row.address.toLowerCase());
  const a=JSON.parse(fs.readFileSync(`contracts/out/${row.type}.sol/${row.type}.json`,'utf8'));
  const fresh=JSON.parse(fs.readFileSync(`audit/contracts/out/${row.type}.sol/${row.type}.json`,'utf8'));
  const vars=nodes(a.ast);
  const marketKey=row.role.startsWith('live')?'live':'replay';
  const expected=row.type==='BondlineMarket'?{usdg:d.usdg,venue:d.markets[marketKey].venue,coverImplementation:d.implementations.cover,accountImplementation:d.implementations.account,maxPriceAge:d.markets[marketKey].maxPriceAge}:row.type==='OracleVenue'?{market:d.markets[marketKey].address,usdg:d.usdg,spreadBps:d.markets[marketKey].spreadBps,maxPriceAge:d.markets[marketKey].maxPriceAge}:row.type==='MirrorFeed'?{keeper:d.wallets.keeper,_decimals:8}:row.type==='ProofOfCover'?{liveMarket:d.markets.live.address,replayMarket:d.markets.replay.address}:{};
  const checks=[];
  for(const [id,values]of Object.entries(row.immutableValues)){
    const name=vars[id];const wanted=expected[name];const encoded=typeof wanted==='string'?wanted.toLowerCase().replace(/^0x/,'').padStart(64,'0'):BigInt(wanted).toString(16).padStart(64,'0');checks.push({name,expected:wanted,allOccurrencesMatch:values.every(x=>x===encoded)});
  }
  const normalizedCode=Buffer.from(ex.deployed_bytecode.replace(/^0x/,''),'hex');
  for(const ranges of Object.values(fresh.deployedBytecode.immutableReferences||{}))for(const range of ranges)normalizedCode.fill(0,range.start,range.start+range.length);
  all.contracts.push({role:row.role,address:row.address,chainAndExplorerCodeHashEqual:keccak256(ex.deployed_bytecode)===row.codeHash,freshRuntimeMaskedEqualsCode:'0x'+normalizedCode.toString('hex')===fresh.deployedBytecode.object,immutableChecks:checks,allExpectedImmutableValuesMatch:checks.every(x=>x.allOccurrencesMatch),eip1967SlotsZero:Object.values(row.eip1967).every(x=>BigInt(x)===0n),explorerVerified:ex.is_verified,partialVerification:ex.is_partially_verified});
}
const clone=(address,code,implementation)=>({address,implementation,expectedCloneCode:'0x363d3d373d3d3d363d73'+implementation.slice(2).toLowerCase()+'5af43d82803e903d91602b57fd5bf3',code,exactTarget:code.toLowerCase()==='0x363d3d373d3d3d363d73'+implementation.slice(2).toLowerCase()+'5af43d82803e903d91602b57fd5bf3'});
for(const[k,m]of Object.entries(s.markets)){
  all.markets[k]={marketUSDBGZero:m.usdgBalance==='0',offers:[]};
  for(const o of m.offers){
    all.clones.push(clone(o.terms.cover,o.bytecode,d.implementations.cover));
    const reserves=o.accounts.reduce((x,a)=>x+BigInt(a.position.reserve),0n);
    all.markets[k].offers.push({address:o.terms.cover,bondEqualsActualBalance:o.book.bond===o.actualUSDG,reservedEqualsSumPositions:BigInt(o.book.reserved)===reserves,freeEqualsBondMinusReserved:BigInt(o.book.free)===BigInt(o.book.bond)-BigInt(o.book.reserved)});
    for(const n of ['bond','reserved'])all.totals[n]+=BigInt(o.book[n]);
    all.totals.premiums+=BigInt(o.book.premiums);all.totals.claims+=BigInt(o.book.claimsPaid);
    for(const a of o.accounts){all.clones.push(clone(a.address,a.bytecode,d.implementations.account));all.totals.principal+=BigInt(a.position.principal);all.totals.covers++;if(a.position.status===1)all.totals.active++;}
  }
}
for(const name of fs.readdirSync('contracts/src').filter(x=>x.endsWith('.sol'))){const orig=fs.readFileSync(`contracts/src/${name}`);const copy=fs.readFileSync(`audit/contracts/src/${name}`);all.sourceHashes.push({file:`contracts/src/${name}`,originalHash:keccak256(orig),auditedHash:keccak256(copy),identical:orig.equals(copy)});}
fs.writeFileSync('audit/evidence/deployment-validation.json',JSON.stringify(all,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
console.log(JSON.stringify({block:all.block,manifestSharedFileEqual:all.manifestSharedFileEqual,allContractsMatch:all.contracts.every(x=>x.chainAndExplorerCodeHashEqual&&x.freshRuntimeMaskedEqualsCode&&x.allExpectedImmutableValuesMatch&&x.eip1967SlotsZero),allClonesCorrect:all.clones.every(x=>x.exactTarget),totals:all.totals},(_,v)=>typeof v==='bigint'?v.toString():v,2));
