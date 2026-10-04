import fs from 'node:fs';
import { priceCover } from '../../shared/src/pricing.ts';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const model = v => priceCover({stockShare: v.wBps/10000, sigma: v.sigmaBps/10000, termDays: v.termDays, limit: v.limitBps/10000, cap: v.capBps/10000});
const fields = {pHitBps:'pTouch', gapBps:'gap', riskBps:'riskPart', reserveBps:'reservePart', fairBps:'fair'};
const vectors=read('stylus/vectors.json');
const mismatches=[];
for (const v of vectors.vectors) {
  const q=model(v);
  for(const [stored,key] of Object.entries(fields)) if(v[stored] !== Math.round(q.bps[key]*10000)) mismatches.push({name:v.name,field:stored,stored:v[stored],current:Math.round(q.bps[key]*10000)});
}
const prices=read('stylus/offchain-prices.json');
const offchainMismatches=[];
for(let wBps=0;wBps<prices.fairByWBps.length;wBps++) {
  const actual=Math.round(model({...prices.inputs,wBps}).bps.fair*10000);
  if(actual!==prices.fairByWBps[wBps])offchainMismatches.push({wBps,stored:prices.fairByWBps[wBps],actual});
}
const old=read('docs/data/backtest.json'),fresh=read('audit/backtest/data/backtest.json');
delete old.generatedAt;delete fresh.generatedAt;delete old.source.block;delete fresh.source.block;
const result={
  generatedAt:new Date().toISOString(),
  stylusStoredVectorCount:vectors.count, actualVectorCount:vectors.vectors.length, checkedIntegers:vectors.vectors.length*5, stylusExpectedValuesMatchCurrentTypeScript:mismatches.length===0,mismatches,
  offchainPriceRows:prices.fairByWBps.length, offchainExpectedValuesMatchCurrentTypeScript:offchainMismatches.length===0,offchainMismatches,
  freshBacktestMatchesStoredExceptGenerationTimeAndBlock:JSON.stringify(old)===JSON.stringify(fresh),
  documentedExamples:[500,1000,1500,2000].map(limitBps=>({limitBps,careful:model({wBps:3000,sigmaBps:5457,termDays:30,limitBps,capBps:3000}).bps.fair,bold:model({wBps:8000,sigmaBps:5457,termDays:30,limitBps,capBps:3000}).bps.fair})),
  scope:'Checks stored Rust/WASM expected outputs against the current TypeScript model, not execution of Rust or WASM.'
};
fs.writeFileSync('audit/evidence/claims-numeric.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
