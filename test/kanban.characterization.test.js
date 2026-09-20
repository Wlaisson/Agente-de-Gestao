// Characterization tests para /api/kanban (fase 6). O repositorio real usa
// o arquivo local kanban_data.json como fallback/cache (comportamento
// original preservado) - removido apos os testes (ja esta no .gitignore).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer } from './helpers/testServer.js';
import { calledWith, findCallArgs } from './helpers/supabaseMock.js';

let ctx;
const kanbanFile = path.join(process.cwd(), 'kanban_data.json');

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  await ctx.close();
  if (fs.existsSync(kanbanFile)) fs.unlinkSync(kanbanFile);
});

function kanbanTable() {
  return (table, calls) => {
    if (table !== 'kanban_cards') return { data: null, error: null };
    if (calledWith(calls, 'select')) return { data: [], error: null }; // forca fallback local
    return { data: null, error: null }; // upsert/update/delete
  };
}

test('GET /api/kanban retorna lista (vazia se nada local/Supabase)', async () => {
  if (fs.existsSync(kanbanFile)) fs.unlinkSync(kanbanFile);
  ctx.supabase.setFromHandler(kanbanTable());
  const res = await fetch(`${ctx.baseUrl}/api/kanban`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.deepEqual(body.data, []);
});

test('POST /api/kanban add_kanban cria card e persiste no cache local', async () => {
  ctx.supabase.setFromHandler(kanbanTable());
  const res = await fetch(`${ctx.baseUrl}/api/kanban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'add_kanban', titulo: 'Tarefa Teste', descricao: 'Desc' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.equal(body.data.titulo, 'Tarefa Teste');
  assert.equal(body.data.status, 'A Fazer');
  assert.ok(body.id.startsWith('K-'));

  const res2 = await fetch(`${ctx.baseUrl}/api/kanban`);
  const body2 = await res2.json();
  assert.equal(body2.data.length, 1);
  assert.equal(body2.data[0].titulo, 'Tarefa Teste');
});

test('POST /api/kanban update_kanban_status atualiza status do card existente', async () => {
  ctx.supabase.setFromHandler(kanbanTable());
  const criar = await fetch(`${ctx.baseUrl}/api/kanban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'add_kanban', titulo: 'Card X' })
  });
  const { id } = await criar.json();

  const res = await fetch(`${ctx.baseUrl}/api/kanban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'update_kanban_status', id, status: 'Em Andamento' })
  });
  assert.equal(res.status, 200);

  const lista = await (await fetch(`${ctx.baseUrl}/api/kanban`)).json();
  const card = lista.data.find(c => c.id === id);
  assert.equal(card.status, 'Em Andamento');
});

test('POST /api/kanban complete_kanban marca Concluido e aplica classificacao/tempo condicionalmente', async () => {
  ctx.supabase.setFromHandler(kanbanTable());
  const criar = await fetch(`${ctx.baseUrl}/api/kanban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'add_kanban', titulo: 'Card Y' })
  });
  const { id } = await criar.json();

  await fetch(`${ctx.baseUrl}/api/kanban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'complete_kanban', id, tempo: '01:30:00', classNivel1: 'C1' })
  });

  const lista = await (await fetch(`${ctx.baseUrl}/api/kanban`)).json();
  const card = lista.data.find(c => c.id === id);
  assert.equal(card.status, 'Concluído');
  assert.equal(card.tempo, '01:30:00');
  assert.equal(card.classNivel1, 'C1');
});

test('POST /api/kanban delete_kanban remove o card', async () => {
  ctx.supabase.setFromHandler(kanbanTable());
  const criar = await fetch(`${ctx.baseUrl}/api/kanban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'add_kanban', titulo: 'Card Z' })
  });
  const { id } = await criar.json();

  const res = await fetch(`${ctx.baseUrl}/api/kanban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'delete_kanban', id })
  });
  assert.equal(res.status, 200);

  const lista = await (await fetch(`${ctx.baseUrl}/api/kanban`)).json();
  assert.ok(!lista.data.some(c => c.id === id));
});

test('POST /api/kanban edit_kanban so altera campos enviados', async () => {
  ctx.supabase.setFromHandler(kanbanTable());
  const criar = await fetch(`${ctx.baseUrl}/api/kanban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'add_kanban', titulo: 'Original', descricao: 'Desc Original' })
  });
  const { id } = await criar.json();

  const res = await fetch(`${ctx.baseUrl}/api/kanban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'edit_kanban', id, titulo: 'Editado' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.titulo, 'Editado');
  assert.equal(body.data.descricao, 'Desc Original');
});

test('POST /api/kanban add_kanban anexa embedding na linha gravada, mas nao na resposta', async () => {
  let upsertPayload = null;
  ctx.supabase.setFromHandler((table, calls) => {
    if (table !== 'kanban_cards') return { data: null, error: null };
    if (calledWith(calls, 'select')) return { data: [], error: null };
    if (calledWith(calls, 'upsert')) {
      upsertPayload = findCallArgs(calls, 'upsert')[0];
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });

  const res = await fetch(`${ctx.baseUrl}/api/kanban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'add_kanban', titulo: 'Card Embedding', descricao: 'Desc' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.ok(Array.isArray(upsertPayload.embedding));
  assert.equal(upsertPayload.embedding.length, 1536);
  assert.equal(body.data.embedding, undefined);
});

test('POST /api/kanban add_kanban: falha na geracao de embedding nao bloqueia a criacao do card', async () => {
  ctx.openai.setEmbeddingHandler(async () => { throw new Error('embeddings indisponivel'); });
  let upsertPayload = null;
  ctx.supabase.setFromHandler((table, calls) => {
    if (table !== 'kanban_cards') return { data: null, error: null };
    if (calledWith(calls, 'select')) return { data: [], error: null };
    if (calledWith(calls, 'upsert')) {
      upsertPayload = findCallArgs(calls, 'upsert')[0];
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });

  const res = await fetch(`${ctx.baseUrl}/api/kanban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'add_kanban', titulo: 'Card Sem Embedding' })
  });
  assert.equal(res.status, 200);
  assert.equal(upsertPayload.embedding, null);

  ctx.openai.setEmbeddingHandler(async () => ({ data: [{ embedding: new Array(1536).fill(0) }] }));
});

test('POST /api/kanban acao invalida -> 400', async () => {
  ctx.supabase.setFromHandler(kanbanTable());
  const res = await fetch(`${ctx.baseUrl}/api/kanban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'nao_existe' })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'Ação inválida');
});
