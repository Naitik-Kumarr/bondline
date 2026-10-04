import fs from 'node:fs';
import { encodeAbiParameters, decodeAbiParameters } from 'viem';
const deployment=JSON.parse(fs.readFileSync('deployments/rhTestnet.json','utf8'));
const rows=[['cover implementation','BondlineCover',deployment.implementations.cover],['account implementation','AgentAccount',deployment.implementations.account],...['live','replay'].flatMap(k=>[[`${k} market`,'BondlineMarket',deployment.markets[k].address],[`${k} venue`,'OracleVenue',deployment.markets[k].venue],...Object.entries(deployment.markets[k].feeds).map(([s,a])=>[`${k} ${s} feed`,'MirrorFeed',a])]),['proof of cover','ProofOfCover',deployment.proofOfCover.address],['USDG','USDG',deployment.usdg],...Object.entries(deployment.assets).map(([s,a])=>[s,s,a])];
const result=await Promise.all(rows.map(async([role,type,address])=>{
  const url=`https://explorer.testnet.chain.robinhood.com/api/v2/smart-contracts/${address}`;
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)return {role,type,address,url,error:`HTTP ${response.status}`};
  const raw=await response.json();
  const selected={role,type,address,url,...Object.fromEntries(['name','is_verified','is_partially_verified','is_fully_verified','constructor_args','decoded_constructor_args','compiler_version','optimization_enabled','optimization_runs','evm_version','proxy_type','implementations','is_changed_bytecode','deployed_bytecode'].map(k=>[k,raw[k]]))};
  if(type in {BondlineMarket:1,OracleVenue:1,MirrorFeed:1,ProofOfCover:1,AgentAccount:1,BondlineCover:1}) {
    const a=JSON.parse(fs.readFileSync(`contracts/out/${type}.sol/${type}.json`,'utf8'));
    const params=a.abi.find(x=>x.type==='constructor')?.inputs||[];
    if(params.length&&raw.constructor_args)selected.constructorDecoded=decodeAbiParameters(params,raw.constructor_args);
  }
  return selected;
}));
fs.writeFileSync('audit/evidence/explorer-snapshot.json',JSON.stringify({command:'node audit/evidence/explorer-probe.mjs',queriedAt:new Date().toISOString(),rows:result},(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
console.log(JSON.stringify(result.map(({role,name,is_verified,proxy_type,implementations,error})=>({role,name,is_verified,proxy_type,implementations,error})),null,2));
