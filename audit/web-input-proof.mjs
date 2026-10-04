// Executes only the unchanged route's input-validation body. All wallet/RPC functions are inert stubs.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { isAddress, getAddress } from 'viem';

const source = readFileSync(new URL('../web/src/app/api/drip/route.ts', import.meta.url), 'utf8');
let validation = source.slice(source.indexOf('export async function POST(request: Request)'));
assert(validation.startsWith('export async function POST(request: Request)'));
validation = validation.replace('export async function POST(request: Request)', 'async function POST(request)')
  .replace('let body: { address?: string };', 'let body;');
const denyEffect = () => { throw new Error('Unexpected wallet/RPC path reached'); };
const POST = new Function('isAddress', 'getAddress', 'isTeamWallet', 'fail', 'oneAtATime', 'drip',
  validation + '\nreturn POST;')(isAddress, getAddress, () => false,
  (status, error) => ({ status, error }), denyEffect, denyEffect);

const results = [];
for (const input of ['null', '{}', '{"address":12}', '{"address":null}', '{"address":"http://127.0.0.1"}']) {
  try {
    const response = await POST({ json: async () => JSON.parse(input) });
    results.push({ input, status: response.status });
  } catch (error) {
    results.push({ input, unexpectedThrow: error.name, message: error.message });
  }
}
console.log(JSON.stringify(results, null, 2));
assert.equal(results[0].status, 400, 'FAIL: JSON null throws outside route catch instead of returning 400');
