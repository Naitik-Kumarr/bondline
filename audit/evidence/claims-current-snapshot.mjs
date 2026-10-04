import fs from 'node:fs';
import {createPublicClient,http,parseAbi} from 'viem';
const base=JSON.parse(fs.readFileSync('audit/evidence/deployment-snapshot.json','utf8'));
const client=createPublicClient({transport:http(base.rpc)});
const blockNumber=await client.getBlockNumber();
const block=await client.getBlock({blockNumber});
const marketAbi=JSON.parse(fs.readFileSync('audit/contracts/out/BondlineMarket.sol/BondlineMarket.json','utf8')).abi;
const coverAbi=parseAbi(['function claimsPaid() view returns(uint256)','function premiums() view returns(uint256)','function bond() view returns(uint256)','function reserved() view returns(uint256)']);
const markets={};
for(const [name,m] of Object.entries(base.markets)) {
 const offers=await client.readContract({address:m.address,abi:marketAbi,functionName:'offers',blockNumber});
 const covers=offers.map(o=>o.cover);
 const books=await Promise.all(covers.map(async address=>({address,...Object.fromEntries(await Promise.all(['claimsPaid','premiums','bond','reserved'].map(async functionName=>[functionName,(await client.readContract({address,abi:coverAbi,functionName,blockNumber})).toString()])))})));
 markets[name]={address:m.address,offers:covers.length,books};
}
const result={rpc:base.rpc,queriedAt:new Date().toISOString(),blockNumber:blockNumber.toString(),blockHash:block.hash,timestamp:block.timestamp.toString(),markets,claimsPaidTotal:Object.values(markets).flatMap(m=>m.books).reduce((sum,b)=>sum+BigInt(b.claimsPaid),0n).toString()};
fs.writeFileSync('audit/evidence/claims-current-snapshot.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
