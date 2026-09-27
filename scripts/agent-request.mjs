// Authorization request only: this script never executes a payment.
import { randomUUID } from 'node:crypto';

const base = process.env.AGENTGUARD_URL ?? 'http://127.0.0.1:8787';
const token = process.env.AGENT_API_TOKEN;
if (!token) throw new Error('Set AGENT_API_TOKEN in the server .env and this process environment.');
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
async function request(path, options = {}) {
  const response = await fetch(`${base}/api/agent/${path}`, { ...options, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.message ?? 'Request failed'}`);
  return body;
}
const { policy } = await request('policy');
const clientRequestId = process.env.AGENT_REQUEST_ID ?? randomUUID();
console.log(JSON.stringify({ clientRequestId }));
const result = await request('requests', {
  method: 'POST',
  body: JSON.stringify({
    policyId: policy.id,
    productId: process.argv[2] ?? 'keyboard-safe',
    fee: 0,
    clientRequestId,
  }),
});
console.log(JSON.stringify(result, null, 2));
