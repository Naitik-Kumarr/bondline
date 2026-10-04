import fs from 'node:fs';
import {createPublicClient,http,keccak256} from 'viem';
const d=JSON.parse(fs.readFileSync('deployments/rhTestnet.json','utf8'));
const snap=JSON.parse(fs.readFileSync('audit/evidence/deployment-snapshot.json','utf8'));
const ex=JSON.parse(fs.readFileSync('audit/evidence/explorer-snapshot.json','utf8'));
const client=createPublicClient({transport:http('https://rpc.testnet.chain.robinhood.com',{timeout:20000})});
const blockNumber=BigInt(snap.block.number);
const frozenAbi=[{type:'function',name:'isFrozen',stateMutability:'view',inputs:[{type:'address',name:'account'}],outputs:[{type:'bool'}]}];
const result={command:'node audit/evidence/deployment-additional.mjs',block:snap.block,queriedAt:new Date().toISOString(),frozen:{},externalProxySlots:{},creationTransactions:[]};
for(const [role,address] of Object.entries(d.wallets))result.frozen[role]=await client.readContract({address:d.usdg,abi:frozenAbi,functionName:'isFrozen',args:[address],blockNumber});
const slots=Object.fromEntries(['implementation','admin','beacon'].map(n=>[n,'0x'+(BigInt(keccak256(new TextEncoder().encode(`eip1967.proxy.${n}`)))-1n).toString(16).padStart(64,'0')]));
for(const [token,address] of Object.entries({USDG:d.usdg,...d.assets})){result.externalProxySlots[token]={};for(const[n,slot]of Object.entries(slots))result.externalProxySlots[token][n]=await client.getStorageAt({address,slot,blockNumber});}
for(const row of ex.rows.filter(x=>!['USDG','TSLA','AMZN'].includes(x.role))){
  const response=await fetch(`https://explorer.testnet.chain.robinhood.com/api/v2/addresses/${row.address}`,{signal:AbortSignal.timeout(20000)});
  const meta=await response.json();
  const hash=meta.creation_transaction_hash;
  const proof={role:row.role,address:row.address,creationTransactionHash:hash};
  if(hash){const tx=await client.getTransaction({hash});const receipt=await client.getTransactionReceipt({hash});const a=JSON.parse(fs.readFileSync(`audit/contracts/out/${row.type}.sol/${row.type}.json`,'utf8'));const input='0x'+a.bytecode.object.replace(/^0x/,'')+(row.constructor_args||'0x').replace(/^0x/,'');const topLevel=tx.to===null&&receipt.contractAddress?.toLowerCase()===row.address.toLowerCase();proof.blockNumber=receipt.blockNumber.toString();proof.status=receipt.status;proof.from=tx.from;proof.to=tx.to;proof.receiptContractAddress=receipt.contractAddress;proof.inputHash=keccak256(tx.input);proof.buildCreationWithReportedArgsHash=keccak256(input);proof.expectedCreationInputMatches=topLevel?tx.input.toLowerCase()===input.toLowerCase():null;proof.note=topLevel?'Top-level creation input checked against fresh isolated build and explorer-reported constructor arguments.':'Internal creation (venue created by market); parent input recorded, runtime and constructor getters checked separately.';}
  result.creationTransactions.push(proof);
}
fs.writeFileSync('audit/evidence/deployment-additional.json',JSON.stringify(result,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
console.log(JSON.stringify(result,null,2));
