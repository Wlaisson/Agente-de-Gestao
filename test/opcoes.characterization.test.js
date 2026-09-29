// Characterization tests para GET/POST /api/opcoes (fase 4: dominio Opcoes).
// Nota: o repositorio faz dual-write no arquivo local opcoes_sistema.json
// (comportamento original, preservado) - o arquivo gerado durante o teste e
// removido no `after` (o caminho ja esta no .gitignore).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer } from './helpers/testServer.js';
import { calledWith } from './helpers/supabaseMock.js';

let ctx;
const opcoesFile = path.join(process.cwd(), 'opcoes_sistema.json');

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  await ctx.close();
  if (fs.existsSync(opcoesFile)) fs.unlinkSync(opcoesFile);
});

const OPCOES_FIXTURE = {
  assuntosInternos: ['Prosis', 'Viamar'],
  projetos: ['Interno'],
  classificacoes: { Cadastro: ['Scraping'] }
};

function opcoesTable(dados) {
  return (table, calls) => {
    if (table !== 'opcoes_sistema') return { data: null, error: null };
    if (calledWith(calls, 'single')) {
      return { data: { dados }, error: null };
    }
    return { data: null, error: null }; // upsert
  };
}

test('GET /api/opcoes retorna os dados vindos do Supabase', async () => {
  ctx.supabaseAdmin.setFromHandler(opcoesTable(OPCOES_FIXTURE));
  const res = await fetch(`${ctx.baseUrl}/api/opcoes`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.deepEqual(body.data, OPCOES_FIXTURE);
});

test('POST /api/opcoes adicionar_assunto inclui item novo e persiste', async () => {
  ctx.supabaseAdmin.setFromHandler(opcoesTable(OPCOES_FIXTURE));
  const res = await fetch(`${ctx.baseUrl}/api/opcoes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'adicionar_assunto', item: 'NovoAssunto' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.ok(body.data.assuntosInternos.includes('NovoAssunto'));
});

test('POST /api/opcoes adicionar_assunto duplicado nao adiciona de novo', async () => {
  ctx.supabaseAdmin.setFromHandler(opcoesTable(OPCOES_FIXTURE));
  const res = await fetch(`${ctx.baseUrl}/api/opcoes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'adicionar_assunto', item: 'Prosis' })
  });
  const body = await res.json();
  assert.equal(body.data.assuntosInternos.filter(a => a === 'Prosis').length, 1);
});

test('POST /api/opcoes salvar_tudo com dados invalidos -> 400', async () => {
  ctx.supabaseAdmin.setFromHandler(opcoesTable(OPCOES_FIXTURE));
  const res = await fetch(`${ctx.baseUrl}/api/opcoes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'salvar_tudo', dados: { assuntosInternos: 'nao-array' } })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'Dados inválidos');
});

test('POST /api/opcoes salvar_tudo com dados validos -> 200', async () => {
  ctx.supabaseAdmin.setFromHandler(opcoesTable(OPCOES_FIXTURE));
  const novosDados = { assuntosInternos: ['A'], projetos: ['B'], classificacoes: {} };
  const res = await fetch(`${ctx.baseUrl}/api/opcoes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'salvar_tudo', dados: novosDados })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.data, novosDados);
});

// Regressao: uma falha transitoria na leitura do Supabase fazia o repositorio
// gravar OPCOES_DEFAULT por cima dos assuntos cadastrados.
function opcoesTableComErroDeLeitura(upserts) {
  return (table, calls) => {
    if (table !== 'opcoes_sistema') return { data: null, error: null };
    if (calledWith(calls, 'single')) {
      return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    }
    upserts.push(calls);
    return { data: null, error: null };
  };
}

test('GET /api/opcoes com erro de leitura -> 503 e NAO sobrescreve com defaults', async () => {
  if (fs.existsSync(opcoesFile)) fs.unlinkSync(opcoesFile);
  const upserts = [];
  ctx.supabaseAdmin.setFromHandler(opcoesTableComErroDeLeitura(upserts));
  const res = await fetch(`${ctx.baseUrl}/api/opcoes`);
  assert.equal(res.status, 503);
  assert.equal(upserts.length, 0);
});

test('POST /api/opcoes adicionar_assunto com erro de leitura -> 503 e NAO grava', async () => {
  if (fs.existsSync(opcoesFile)) fs.unlinkSync(opcoesFile);
  const upserts = [];
  ctx.supabaseAdmin.setFromHandler(opcoesTableComErroDeLeitura(upserts));
  const res = await fetch(`${ctx.baseUrl}/api/opcoes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'adicionar_assunto', item: 'NovoAssunto' })
  });
  assert.equal(res.status, 503);
  assert.equal(upserts.length, 0);
});

test('GET /api/opcoes sem linha no banco (PGRST116) faz o seed inicial', async () => {
  if (fs.existsSync(opcoesFile)) fs.unlinkSync(opcoesFile);
  const upserts = [];
  ctx.supabaseAdmin.setFromHandler((table, calls) => {
    if (calledWith(calls, 'single')) return { data: null, error: { code: 'PGRST116' } };
    upserts.push(calls);
    return { data: null, error: null };
  });
  const res = await fetch(`${ctx.baseUrl}/api/opcoes`);
  assert.equal(res.status, 200);
  assert.equal(upserts.length, 1);
});

test('POST /api/opcoes acao invalida -> 400', async () => {
  ctx.supabaseAdmin.setFromHandler(opcoesTable(OPCOES_FIXTURE));
  const res = await fetch(`${ctx.baseUrl}/api/opcoes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'acao_que_nao_existe' })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'Ação de opções inválida');
});
