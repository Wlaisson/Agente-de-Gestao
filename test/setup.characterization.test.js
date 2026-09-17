import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/testServer.js';
import { calledWith, findCallArgs } from './helpers/supabaseMock.js';

let ctx;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  await ctx.close();
});

test('GET /api/setup/:userId sem registro -> configured:false com defaults', async () => {
  ctx.supabaseAdmin.setFromHandler(() => ({ data: null, error: { message: 'not found' } }));
  const res = await fetch(`${ctx.baseUrl}/api/setup/u1`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.configured, false);
  assert.equal(body.openai_model, 'gpt-4o-mini');
});

test('GET /api/setup/:userId com registro -> mascara a chave da OpenAI', async () => {
  ctx.supabaseAdmin.setFromHandler(() => ({
    data: { openai_api_key: 'sk-abcdef1234', openai_model: 'gpt-4o', nome_pdf: 'X' },
    error: null
  }));
  const res = await fetch(`${ctx.baseUrl}/api/setup/u1`);
  const body = await res.json();
  assert.equal(body.configured, true);
  assert.equal(body.apiKeyMasked, 'sk-...1234');
  assert.equal(body.nome_pdf, 'X');
});

test('POST /api/setup sem userId -> 400', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
});

test('POST /api/setup: mantem a chave existente quando nao envia uma nova', async () => {
  ctx.supabaseAdmin.setFromHandler((table, calls) => {
    if (calledWith(calls, 'single')) {
      return { data: { openai_api_key: 'sk-existente', openai_model: 'gpt-4o-mini' }, error: null };
    }
    return { data: null, error: null };
  });

  const res = await fetch(`${ctx.baseUrl}/api/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u1', nome_pdf: 'Nova Empresa' })
  });
  assert.equal(res.status, 200);
});

test('POST /api/setup: sobrescreve a chave quando um valor novo e enviado', async () => {
  let upsertPayload = null;
  ctx.supabaseAdmin.setFromHandler((table, calls) => {
    if (calledWith(calls, 'single')) return { data: null, error: { message: 'not found' } };
    if (calledWith(calls, 'upsert')) {
      upsertPayload = findCallArgs(calls, 'upsert')[0];
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });

  await fetch(`${ctx.baseUrl}/api/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'u1', openai_api_key: '  sk-novachave  ' })
  });
  assert.equal(upsertPayload.openai_api_key, 'sk-novachave');
});
