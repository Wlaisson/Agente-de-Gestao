// Characterization tests para /api/atividades (fase 5).
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

function atividadesTable({ listResult = [], upsertError = null, updateError = null, deleteError = null } = {}) {
  return (table, calls) => {
    if (table !== 'atividades') return { data: null, error: null };
    if (calledWith(calls, 'upsert')) return { data: null, error: upsertError };
    if (calledWith(calls, 'update')) return { data: null, error: updateError };
    if (calledWith(calls, 'delete')) return { data: null, error: deleteError };
    return { data: listResult, error: null }; // select/order/eq/gte/lte chain
  };
}

test('GET /api/atividades sem userId -> 401', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/atividades`);
  assert.equal(res.status, 401);
});

test('GET /api/atividades formata linhas do banco (semana calculada quando ausente)', async () => {
  ctx.supabaseAdmin.setFromHandler(atividadesTable({
    listResult: [
      { id: 'ATV-1', user_id: 'u1', data: '2026-01-05', semana: '', projeto: 'P', assunto_interno: 'A', titulo: 'T', atividade: 'desc', tempo: '01:00:00', class_nivel_1: 'C1', class_nivel_2: 'C2' }
    ]
  }));
  const res = await fetch(`${ctx.baseUrl}/api/atividades`, { headers: { 'x-user-id': 'u1' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data[0].assuntoInterno, 'A');
  assert.equal(body.data[0].diaSemana, 'segunda-feira');
  assert.ok(body.data[0].semana.includes('/'));
});

test('GET /api/atividades preserva item.semana quando ja preenchida', async () => {
  ctx.supabaseAdmin.setFromHandler(atividadesTable({
    listResult: [
      { id: 'ATV-2', user_id: 'u1', data: '2026-01-05', semana: 'semana-customizada', projeto: '', assunto_interno: '', titulo: '', atividade: '', tempo: '00:00:00', class_nivel_1: '', class_nivel_2: '' }
    ]
  }));
  const res = await fetch(`${ctx.baseUrl}/api/atividades`, { headers: { 'x-user-id': 'u1' } });
  const body = await res.json();
  assert.equal(body.data[0].semana, 'semana-customizada');
});

test('POST /api/atividades sem userId -> 401', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/atividades`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: '2026-01-05' })
  });
  assert.equal(res.status, 401);
});

test('POST /api/atividades aceita nomes de campo estilo planilha (compat retroativa)', async () => {
  ctx.supabaseAdmin.setFromHandler(atividadesTable({}));
  const res = await fetch(`${ctx.baseUrl}/api/atividades`, {
    method: 'POST',
    headers: { 'x-user-id': 'u1', 'content-type': 'application/json' },
    body: JSON.stringify({
      Data: '2026-01-05',
      Projeto: 'ProjetoX',
      'Assunto Interno': 'AssuntoX',
      'Título': 'TituloX',
      'Atividade [Deixar claro no texto]': 'DescricaoX',
      'Tempo (HH:MM:SS)': '02:00:00'
    })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.projeto, 'ProjetoX');
  assert.equal(body.data.assunto_interno, 'AssuntoX');
  assert.equal(body.data.titulo, 'TituloX');
  assert.equal(body.data.atividade, 'DescricaoX');
  assert.equal(body.data.tempo, '02:00:00');
  assert.ok(body.data.id.startsWith('ATV-'));
  assert.ok(body.data.semana.includes('/'));
});

test('POST /api/atividades erro do Supabase -> 500 com mensagem', async () => {
  ctx.supabaseAdmin.setFromHandler(atividadesTable({ upsertError: { message: 'falha no upsert' } }));
  const res = await fetch(`${ctx.baseUrl}/api/atividades`, {
    method: 'POST',
    headers: { 'x-user-id': 'u1', 'content-type': 'application/json' },
    body: JSON.stringify({ data: '2026-01-05' })
  });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error, 'falha no upsert');
});

test('PUT /api/atividades/:id atualiza so os campos enviados', async () => {
  ctx.supabaseAdmin.setFromHandler(atividadesTable({}));
  const res = await fetch(`${ctx.baseUrl}/api/atividades/ATV-1`, {
    method: 'PUT',
    headers: { 'x-user-id': 'u1', 'content-type': 'application/json' },
    body: JSON.stringify({ titulo: 'Novo Titulo' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
});

test('DELETE /api/atividades/:id -> 200', async () => {
  ctx.supabaseAdmin.setFromHandler(atividadesTable({}));
  const res = await fetch(`${ctx.baseUrl}/api/atividades/ATV-1`, {
    method: 'DELETE',
    headers: { 'x-user-id': 'u1' }
  });
  assert.equal(res.status, 200);
});

test('POST /api/atividades anexa embedding na linha gravada, mas nao no JSON de resposta', async () => {
  let upsertPayload = null;
  ctx.supabaseAdmin.setFromHandler((table, calls) => {
    if (table !== 'atividades') return { data: null, error: null };
    if (calledWith(calls, 'upsert')) {
      upsertPayload = findCallArgs(calls, 'upsert')[0];
      return { data: null, error: null };
    }
    return { data: [], error: null };
  });

  const res = await fetch(`${ctx.baseUrl}/api/atividades`, {
    method: 'POST',
    headers: { 'x-user-id': 'u1', 'content-type': 'application/json' },
    body: JSON.stringify({ data: '2026-01-05', titulo: 'Reuniao', atividade: 'Alinhamento com cliente' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.ok(Array.isArray(upsertPayload.embedding));
  assert.equal(upsertPayload.embedding.length, 1536);
  assert.equal(body.data.embedding, undefined);
});

test('POST /api/atividades: coluna embedding ausente no banco (migracao nao rodada) nao bloqueia a escrita', async () => {
  let upsertCalls = 0;
  let ultimoPayload = null;
  ctx.supabaseAdmin.setFromHandler((table, calls) => {
    if (table !== 'atividades') return { data: null, error: null };
    if (calledWith(calls, 'upsert')) {
      upsertCalls += 1;
      ultimoPayload = findCallArgs(calls, 'upsert')[0];
      if (upsertCalls === 1) {
        return { data: null, error: { code: 'PGRST204', message: "Could not find the 'embedding' column of 'atividades' in the schema cache" } };
      }
      return { data: null, error: null };
    }
    return { data: [], error: null };
  });

  const res = await fetch(`${ctx.baseUrl}/api/atividades`, {
    method: 'POST',
    headers: { 'x-user-id': 'u1', 'content-type': 'application/json' },
    body: JSON.stringify({ data: '2026-01-05', titulo: 'X', atividade: 'Y' })
  });
  assert.equal(res.status, 200);
  assert.equal(upsertCalls, 2);
  assert.equal('embedding' in ultimoPayload, false);
});

test('PUT /api/atividades/:id: coluna embedding ausente no banco (migracao nao rodada) nao bloqueia a atualizacao', async () => {
  let updateCalls = 0;
  let ultimoPayload = null;
  ctx.supabaseAdmin.setFromHandler((table, calls) => {
    if (table !== 'atividades') return { data: null, error: null };
    if (calledWith(calls, 'update')) {
      updateCalls += 1;
      ultimoPayload = findCallArgs(calls, 'update')[0];
      if (updateCalls === 1) {
        return { data: null, error: { code: 'PGRST204', message: "Could not find the 'embedding' column of 'atividades' in the schema cache" } };
      }
      return { data: null, error: null };
    }
    return { data: [], error: null };
  });

  const res = await fetch(`${ctx.baseUrl}/api/atividades/ATV-1`, {
    method: 'PUT',
    headers: { 'x-user-id': 'u1', 'content-type': 'application/json' },
    body: JSON.stringify({ titulo: 'Novo Titulo', atividade: 'Nova descricao' })
  });
  assert.equal(res.status, 200);
  assert.equal(updateCalls, 2);
  assert.equal('embedding' in ultimoPayload, false);
});

test('POST /api/atividades: falha na geracao de embedding nao bloqueia a escrita (degrada para null)', async () => {
  ctx.openai.setEmbeddingHandler(async () => { throw new Error('embeddings indisponivel'); });
  let upsertPayload = null;
  ctx.supabaseAdmin.setFromHandler((table, calls) => {
    if (table !== 'atividades') return { data: null, error: null };
    if (calledWith(calls, 'upsert')) {
      upsertPayload = findCallArgs(calls, 'upsert')[0];
      return { data: null, error: null };
    }
    return { data: [], error: null };
  });

  const res = await fetch(`${ctx.baseUrl}/api/atividades`, {
    method: 'POST',
    headers: { 'x-user-id': 'u1', 'content-type': 'application/json' },
    body: JSON.stringify({ data: '2026-01-05', titulo: 'X', atividade: 'Y' })
  });
  assert.equal(res.status, 200);
  assert.equal(upsertPayload.embedding, null);

  // restaura o handler padrao de embeddings para nao vazar para outros testes deste arquivo
  ctx.openai.setEmbeddingHandler(async () => ({ data: [{ embedding: new Array(1536).fill(0) }] }));
});
