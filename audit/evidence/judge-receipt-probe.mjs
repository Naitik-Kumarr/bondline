import fs from 'node:fs';
import {createPublicClient,http,decodeEventLog,decodeFunctionData} from 'viem';
const html=fs.readFileSync('audit/evidence/judge-local-3110.http','utf8');
const hashes=[...new Set([...html.matchAll(/\/tx\/(0x[0-9a-fA-F]{64})/g)].map(x=>x[1]))].filter(x=>x.startsWith('0xb0b099a4')||x.startsWith('0xbb0d0fd9'));
const client=createPublicClient({transport:http('https://rpc.testnet.chain.robinhood.com',{timeout:20000})});
const abis=['BondlineMarket','BondlineCover','AgentAccount'].map(n=>JSON.parse(fs.readFileSync(`audit/contracts/out/${n}.sol/${n}.json`,'utf8')).abi);
const rows=[];
for(const hash of hashes){const receipt=await client.getTransactionReceipt({hash});const tx=await client.getTransaction({hash});const row={hash,blockNumber:receipt.blockNumber.toString(),status:receipt.status,to:tx.to,events:[]};for(const abi of abis){try{row.call={functionName:decodeFunctionData({abi,data:tx.input}).functionName};break;}catch{}}for(const log of receipt.logs)for(const abi of abis){try{const decoded=decodeEventLog({abi,data:log.data,topics:log.topics});row.events.push({address:log.address,...decoded});break;}catch{}}rows.push(row);}
fs.writeFileSync('audit/evidence/judge-moment-receipts.json',JSON.stringify({command:'node audit/evidence/judge-receipt-probe.mjs',queriedAt:new Date().toISOString(),rows},(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
console.log(JSON.stringify(rows.map(x=>({hash:x.hash,block:x.blockNumber,status:x.status,call:x.call?.functionName,events:x.events})),(_,v)=>typeof v==='bigint'?v.toString():v,2));
