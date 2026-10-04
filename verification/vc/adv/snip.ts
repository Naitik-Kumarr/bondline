import { Bondline, configFromEnv } from "@bondline/sdk";
const sdk = new Bondline(configFromEnv());
const o = await sdk.listOffers({ market: "live", listedOnly: true });
const q = await sdk.quoteCover({ market: "live", offerId: 0, amount: "100", limitBps: 1000 });
const r = sdk.getAgentRecord("0x230d2a366d7724a6f5F416BB1d80299BC8E487eF");
console.log(o.length, q.ok, String(q.premium), r.record?.name);
