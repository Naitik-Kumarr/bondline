/* Offline proof of the actual drip route's quota logic. No network or signing.
 * All imported clients and the account are stubs; the real route source runs
 * unchanged after TypeScript transpilation. Distinct VM contexts model distinct
 * Next/Vercel server instances with separate module-local `tail` queues.
 */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('../../node_modules/typescript');
const sourcePath = '/Users/naitik/surety/web/src/app/api/drip/route.ts';
const js = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
const amount = 5_000_000n;
const account = '0x1111111111111111111111111111111111111111';
const recipient = i => '0x' + BigInt(100+i).toString(16).padStart(40, '0');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function chain(expectedSnapshots = 1, synchronize = false) {
  let unblock;
  const gate = new Promise(resolve => {unblock = resolve;});
  return {
    logs: [], nonce: 0, balance: 100_000_000n, calls: 0,
    async snapshot() {
      const snapshot = this.logs.slice();
      this.calls++;
      if (!synchronize) return snapshot;
      if (this.calls === expectedSnapshots) unblock();
      await gate;
      return snapshot;
    },
  };
}

function instance(sharedChain, instanceId = 0) {
  const transactions = new Map();
  const publicClient = {
    async readContract({functionName}) {
      return functionName === 'balanceOf' ? sharedChain.balance : false;
    },
    async getBlockNumber() {return 1n;},
    async getLogs() {return sharedChain.snapshot();},
    async getBlock() {return {timestamp: 100_000n};},
    async getTransactionCount() {
      // Stagger RPC responses after every instance has read confirmed logs.
      // Each signer observes the current pending nonce, a valid RPC ordering.
      await sleep(instanceId * 5);
      return sharedChain.nonce;
    },
    async waitForTransactionReceipt({hash}) {
      const tx = transactions.get(hash);
      sharedChain.logs.push({args: {to: tx.to, value: tx.value}, blockNumber: 1n});
      sharedChain.balance -= tx.value;
      return {status: 'success'};
    },
  };
  const walletClient = {
    async writeContract({args: [to, value], nonce}) {
      assert.equal(nonce, sharedChain.nonce, 'fresh pending nonce');
      sharedChain.nonce++;
      const hash = 'offline-mock-tx-' + sharedChain.nonce;
      transactions.set(hash, {to, value});
      return hash;
    },
  };
  const imports = {
    'next/server': {NextResponse: {json: (body, init = {}) => ({body, status: init.status ?? 200})}},
    'viem': {
      createPublicClient: () => publicClient,
      createWalletClient: () => walletClient,
      getAddress: x => x,
      http: () => ({}),
      isAddress: x => typeof x === 'string' && /^0x[0-9a-f]{40}$/i.test(x),
      parseAbiItem: x => x,
    },
    'viem/accounts': {privateKeyToAccount: () => ({address: account})},
    '@bondline/shared': {
      deployment: {markets: {live: {deployBlock: 1}}},
      isTeamWallet: () => false,
      robinhoodTestnet: {},
      txUrl: x => x,
      USDG: '0x2222222222222222222222222222222222222222',
      usdgAbi: [],
    },
  };
  const context = {
    exports: {},
    require: name => {assert.ok(imports[name], 'unexpected import'); return imports[name];},
    process: {env: {DRIP_PRIVATE_KEY: 'offline-stub-only'}},
    Promise,
  };
  vm.runInNewContext(js, context, {filename: sourcePath});
  return context.exports.POST;
}

function request(address) {
  return {
    json: async () => ({address}),
    headers: {get: name => /ip|forwarded|real/i.test(name) ? '192.0.2.10' : null},
  };
}

(async () => {
  const results = [];
  {
    const state = chain();
    const post = instance(state);
    const replies = [];
    for (let i=0; i<7; i++) replies.push(await post(request(recipient(i))));
    assert.deepEqual(replies.map(r => r.status), [200,200,200,200,200,200,429]);
    const repeat = await post(request(recipient(0)));
    assert.equal(repeat.status, 409);
    results.push({proof: 'same_ip_six_new_addresses_exhaust_daily_quota',
      accepted: 6, sameIp: true, sentUSDG: Number((100_000_000n-state.balance)/1_000_000n),
      subsequentRequestStatus: replies[6].status, sameAddressRepeatStatus: repeat.status});
  }
  {
    const state = chain(7, true);
    const replies = await Promise.all(Array.from({length: 7}, (_, i) => instance(state, i)(request(recipient(i)))));
    assert.deepEqual(replies.map(r => r.status), [200,200,200,200,200,200,200]);
    const sent = 100_000_000n - state.balance;
    assert.ok(sent > 30_000_000n, 'daily cap exceeded');
    results.push({proof: 'separate_instances_exceed_daily_cap', instances: 7,
      accepted: replies.filter(r => r.status === 200).length, sentUSDG: Number(sent/1_000_000n), advertisedCapUSDG: 30});
  }
  {
    const state = chain(2, true);
    const replies = await Promise.all([instance(state, 0),instance(state, 1)].map(post => post(request(recipient(99)))));
    assert.deepEqual(replies.map(r => r.status), [200,200]);
    const repeated = state.logs.filter(l => l.args.to === recipient(99)).length;
    assert.equal(repeated, 2);
    results.push({proof: 'separate_instances_pay_same_address_twice', instances: 2,
      recipientPayments: repeated, sentUSDG: Number((100_000_000n-state.balance)/1_000_000n)});
  }
  {
    const state = chain(20, true);
    const replies = await Promise.all(Array.from({length: 20}, (_, i) => instance(state, i)(request(recipient(i)))));
    assert.equal(replies.filter(r => r.status === 200).length, 20);
    assert.equal(state.balance, 0n);
    results.push({proof: 'separate_instances_drain_funded_wallet_from_same_ip',
      instances: 20, accepted: 20, initialUSDG: 100, remainingUSDG: 0, sameIp: true});
  }
  console.log(JSON.stringify({source: 'web/src/app/api/drip/route.ts', sourceUnmodified: true,
    networkCalls: 0, signedTransactions: 0, results}, null, 2));
})().catch(error => {console.error(error.message); process.exitCode = 1;});
