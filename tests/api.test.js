import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { validateFiles, createQuotaConsumer } from '../server/security.js';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

async function fixture(t, overrides = {}) {
  let calls = 0;
  const app = createApp({
    verifyToken: async token => {
      if (token === 'invalid') throw new Error('secret credentials');
      return { uid: token, kokoAccess: token !== 'uninvited', companyId: 'company-a', role: token === 'viewer' ? 'viewer' : 'staff' };
    }, consumeQuota: async () => true,
    generate: async () => { calls++; return { text: JSON.stringify({ items: [] }) }; },
    origins: ['https://koko-invoice.web.app'], ...overrides
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { calls: () => calls, request: (path, options) => fetch(url + path, options) };
}
async function form(count = 1, type = 'image/png') {
  const data = new FormData();
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
  for (let i = 0; i < count; i++) data.append('files', new Blob([png], { type }), 'invoice.png');
  return data;
}
const options = async (token = 'customer', count = 1, type) => ({ method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: await form(count, type) });

test('health contains no configuration', async t => {
  const api = await fixture(t);
  assert.deepEqual(await (await api.request('/api/health')).json(), { ok: true });
});
test('reject missing, forged and uninvited identities before AI', async t => {
  const api = await fixture(t);
  assert.equal((await api.request('/api/parse-invoice', { method: 'POST' })).status, 401);
  assert.equal((await api.request('/api/parse-invoice', await options('invalid'))).status, 401);
  assert.equal((await api.request('/api/parse-invoice', await options('uninvited'))).status, 403);
  assert.equal((await api.request('/api/parse-invoice', await options('viewer'))).status, 403);
  assert.equal(api.calls(), 0);
});
test('restrict CORS and permit approved preflight', async t => {
  const api = await fixture(t);
  assert.equal((await api.request('/api/health', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const res = await api.request('/api/parse-invoice', { method: 'OPTIONS', headers: { Origin: 'https://koko-invoice.web.app', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://koko-invoice.web.app');
});
test('valid authenticated upload reaches AI', async t => {
  const api = await fixture(t);
  const res = await api.request('/api/parse-invoice', await options());
  assert.equal(res.status, 200); assert.equal(api.calls(), 1);
});
test('reject excess files, unsupported MIME, and caller API keys', async t => {
  const api = await fixture(t);
  assert.equal((await api.request('/api/parse-invoice', await options('customer', 6))).status, 400);
  assert.equal((await api.request('/api/parse-invoice', await options('customer', 1, 'text/html'))).status, 400);
  const opts = await options(); opts.body.append('apiKey', 'secret');
  assert.equal((await api.request('/api/parse-invoice', opts)).status, 400);
  assert.equal(api.calls(), 0);
});
test('daily quota and quota store failures fail closed', async t => {
  for (const consumeQuota of [async () => false, async () => { throw new Error(); }]) {
    const api = await fixture(t, { consumeQuota });
    const res = await api.request('/api/parse-invoice', await options());
    assert.ok([429, 503].includes(res.status)); assert.equal(api.calls(), 0);
  }
});
test('AI errors do not disclose internals', async t => {
  const api = await fixture(t, { generate: async () => { throw new Error('SECRET_KEY'); } });
  const res = await api.request('/api/parse-invoice', await options());
  assert.equal(res.status, 500); assert.deepEqual(await res.json(), { error: 'Invoice processing failed.' });
});
test('IP burst limiter rejects excess requests', async t => {
  const api = await fixture(t);
  for (let i = 0; i < 30; i++) await api.request('/api/parse-invoice', { method: 'POST' });
  assert.equal((await api.request('/api/parse-invoice', { method: 'POST' })).status, 429);
});
test('file contents, image dimensions and PDF page count are enforced', async () => {
  await assert.rejects(validateFiles([{ buffer: Buffer.from('fake'), mimetype: 'image/png' }]));
  const pdf = await PDFDocument.create(); for (let i = 0; i < 11; i++) pdf.addPage();
  await assert.rejects(validateFiles([{ buffer: Buffer.from(await pdf.save()), mimetype: 'application/pdf' }]));
  const big = await sharp({ create: { width: 10001, height: 1, channels: 3, background: 'white' } }).png().toBuffer();
  await assert.rejects(validateFiles([{ buffer: big, mimetype: 'image/png' }]));
});
test('durable quota enforces per-user minute and daily caps', async () => {
  const records = new Map();
  const db = { collection: name => ({ doc: uid => `${name}/${uid}` }), runTransaction: fn => fn({ get: async ref => ({ data: () => records.get(ref) }), set: (ref, value) => records.set(ref, value) }) };
  const consume = createQuotaConsumer(db);
  for (let i = 0; i < 10; i++) assert.equal(await consume('one'), true);
  assert.equal(await consume('one'), false);
  assert.equal(await consume('two'), true);
  records.set('_aiUsage/one', { day: new Date().toISOString().slice(0, 10), dailyCount: 100, minute: -1 });
  assert.equal(await consume('one'), false);
});
test('five files are accepted at the boundary', async t => {
  const api = await fixture(t);
  assert.equal((await api.request('/api/parse-invoice', await options('customer', 5))).status, 200);
});
test('concurrent scans by one user are rejected', async t => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let finish;
  const api = await fixture(t, { generate: async () => { entered(); await new Promise(resolve => { finish = resolve; }); return { text: '{"items":[]}' }; } });
  const first = api.request('/api/parse-invoice', await options());
  await started;
  assert.equal((await api.request('/api/parse-invoice', await options())).status, 429);
  finish(); assert.equal((await first).status, 200);
});
test('company daily cap is shared across staff', async () => {
  const records = new Map([['_aiCompanyUsage/acme', { day: new Date().toISOString().slice(0, 10), dailyCount: 499 }]]);
  const db = { collection: name => ({ doc: uid => `${name}/${uid}` }), runTransaction: fn => fn({ get: async ref => ({ data: () => records.get(ref) }), set: (ref, value) => records.set(ref, value) }) };
  const consume = createQuotaConsumer(db);
  assert.equal(await consume('alice', 'acme'), true);
  assert.equal(await consume('bob', 'acme'), false);
  assert.equal(await consume('carol', 'other'), true);
});
