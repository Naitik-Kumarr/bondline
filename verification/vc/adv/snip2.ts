import { Bondline, configFromEnv } from "@bondline/sdk";
const sdk = new Bondline(configFromEnv());
const q = await sdk.quoteCover({ market: "live", offerId: 1, amount: "100", limitBps: 1000, rules: { maxStockBps: 8000 } });
console.log(q.ok, q.reference?.worstCase.fairBps, q.reference?.worstCase.stockShare, q.rules);
const q2 = await sdk.quoteCover({ market: "live", offerId: 1, amount: "100", limitBps: 2000, rules: { maxStockBps: 8000 } });
console.log(q2.reference?.worstCase.fairBps);
