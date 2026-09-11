import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { isAuthorizedTrigger, queueEmailApproval } from './worker.js';

test('POST is fail-closed without configured trigger secret', async () => {
  const request = new Request('https://worker.example/', { method: 'POST' });
  assert.equal(isAuthorizedTrigger(request, {}), false);
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 401);
});

test('trigger requires the exact bearer token', () => {
  const env = { MI_TRIGGER_TOKEN: 'expected' };
  assert.equal(isAuthorizedTrigger(new Request('https://x/', { headers: { Authorization: 'Bearer wrong' } }), env), false);
  assert.equal(isAuthorizedTrigger(new Request('https://x/', { headers: { Authorization: 'Bearer expected' } }), env), true);
});

test('outbound becomes PENDING_APPROVAL and never calls Resend', async () => {
  const original = globalThis.fetch;
  let url;
  let payload;
  globalThis.fetch = async (target, options) => {
    url = String(target);
    payload = JSON.parse(options.body);
    return new Response('{}', { status: 201 });
  };
  try {
    await queueEmailApproval({}, { to: 'test@example.com', subject: 'test', html: '<p>x</p>' });
  } finally {
    globalThis.fetch = original;
  }
  assert.match(url, /\/outbound-approvals$/);
  assert.doesNotMatch(url, /resend/i);
  assert.equal(payload.state, 'PENDING_APPROVAL');
});
