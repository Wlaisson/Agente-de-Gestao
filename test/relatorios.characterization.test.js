// Characterization tests para /api/gerar-relatorio e
// /api/gerar-relatorio-reporter (fase 8) - as duas rotas agora compartilham
// GerarRelatorioSemanalUseCase, diferindo so pelo `modo`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/testServer.js';

let ctx;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  await ctx.close();
});

function atividadesSemanaTable(linhas) {
  return (table) => {
    if (table !== 'atividades') return { data: null, error: null };
    return { data: linhas, error: null };
  };
}

test('POST /api/gerar-relatorio sem semana -> 400', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/gerar-relatorio`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
});

test('POST /api/gerar-relatorio: semana sem atividades -> status empty', async () => {
  ctx.supabaseAdmin.setFromHandler(atividadesSemanaTable([]));
  const res = await fetch(`${ctx.baseUrl}/api/gerar-relatorio`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ semana: '05/01 a 11/01' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'empty');
  assert.deepEqual(body.resumo, []);
});

test('POST /api/gerar-relatorio: agrupa por assunto e retorna o relatorio da IA', async () => {
  ctx.supabaseAdmin.setFromHandler(atividadesSemanaTable([
    { titulo: 'T1', atividade: 'desc1', assunto_interno: 'Prosis', projeto: 'Interno', tempo: '01:00:00' },
    { titulo: 'T2', atividade: 'desc2', assunto_interno: 'Prosis', projeto: 'Interno', tempo: '00:30:00' }
  ]));
  ctx.openai.setChatHandler(async () => ({
    choices: [{ message: { content: JSON.stringify({ relatorio: [{ titulo: 'Prosis', descricao: '<ul></ul>' }] }) } }]
  }));

  const res = await fetch(`${ctx.baseUrl}/api/gerar-relatorio`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ semana: '05/01 a 11/01' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.equal(body.resumo[0].titulo, 'Prosis');
});

test('POST /api/gerar-relatorio: resposta da IA invalida cai no item "Erro de Formatação"', async () => {
  ctx.supabaseAdmin.setFromHandler(atividadesSemanaTable([
    { titulo: 'T1', atividade: 'desc1', assunto_interno: 'X', projeto: '', tempo: '' }
  ]));
  ctx.openai.setChatHandler(async () => ({
    choices: [{ message: { content: 'isso nao e json' } }]
  }));

  const res = await fetch(`${ctx.baseUrl}/api/gerar-relatorio`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ semana: '05/01 a 11/01' })
  });
  const body = await res.json();
  assert.equal(body.resumo[0].titulo, 'Erro de Formatação');
});

test('POST /api/gerar-relatorio-reporter: semana sem atividades -> status empty com quadrantes', async () => {
  ctx.supabaseAdmin.setFromHandler(atividadesSemanaTable([]));
  const res = await fetch(`${ctx.baseUrl}/api/gerar-relatorio-reporter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ semana: '05/01 a 11/01' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'empty');
  assert.deepEqual(body.quadrantes, []);
});

test('POST /api/gerar-relatorio-reporter: retorna quadrantes da IA', async () => {
  ctx.supabaseAdmin.setFromHandler(atividadesSemanaTable([
    { titulo: 'T1', atividade: 'desc1', assunto_interno: 'Prosis', projeto: 'Interno', tempo: '01:00:00' }
  ]));
  ctx.openai.setChatHandler(async () => ({
    choices: [{
      message: {
        content: JSON.stringify({ quadrantes: [{ assunto: 'Prosis', itens: [{ titulo: 'Manutenção', resumo: 'Resumo X' }] }] })
      }
    }]
  }));

  const res = await fetch(`${ctx.baseUrl}/api/gerar-relatorio-reporter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ semana: '05/01 a 11/01' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.quadrantes[0].assunto, 'Prosis');
  assert.equal(body.quadrantes[0].itens[0].titulo, 'Manutenção');
});

test('POST /api/gerar-relatorio-reporter: resposta invalida reconstroi quadrantes a partir do agrupamento', async () => {
  ctx.supabaseAdmin.setFromHandler(atividadesSemanaTable([
    { titulo: 'T1', atividade: 'desc1', assunto_interno: 'Prosis', projeto: '', tempo: '' }
  ]));
  ctx.openai.setChatHandler(async () => ({
    choices: [{ message: { content: 'nao e json' } }]
  }));

  const res = await fetch(`${ctx.baseUrl}/api/gerar-relatorio-reporter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ semana: '05/01 a 11/01' })
  });
  const body = await res.json();
  assert.equal(body.quadrantes[0].assunto, 'Prosis');
  assert.equal(body.quadrantes[0].itens[0].titulo, 'T1');
});

test('POST /api/gerar-relatorio-reporter sem semana -> 400', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/gerar-relatorio-reporter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
});
