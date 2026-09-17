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

test('POST /api/processar-reuniao sem transcricao -> 400', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/processar-reuniao`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
});

test('POST /api/processar-reuniao: extrai minhas_tarefas e filtra placeholders', async () => {
  ctx.openai.setChatHandler(async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          nome_reuniao: 'Daily',
          data_reuniao: '2026-01-05',
          resumo_geral: 'Resumo real da reunião',
          minhas_tarefas: [
            { tarefa: 'Corrigir bug de login', contexto: 'Erro 401', prazo_mencionado: 'quarta' },
            { tarefa: 'descrição da tarefa', contexto: '...', prazo_mencionado: '' }
          ]
        })
      }
    }]
  }));

  const res = await fetch(`${ctx.baseUrl}/api/processar-reuniao`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nome_reuniao: 'Daily', data_reuniao: '2026-01-05', transcricao: 'texto da reuniao' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.resumo_geral, 'Resumo real da reunião');
  // a 2a tarefa e um placeholder ("descrição da tarefa") e deve ser filtrada
  assert.equal(body.minhas_tarefas.length, 1);
  assert.equal(body.minhas_tarefas[0].tarefa, 'Corrigir bug de login');
});

test('POST /api/processar-reuniao: resposta nao-JSON cai no fallback vazio', async () => {
  ctx.openai.setChatHandler(async () => ({
    choices: [{ message: { content: 'isso nao e json' } }]
  }));

  const res = await fetch(`${ctx.baseUrl}/api/processar-reuniao`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nome_reuniao: 'Daily', data_reuniao: '2026-01-05', transcricao: 'texto' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.nome_reuniao, 'Daily');
  assert.deepEqual(body.minhas_tarefas, []);
});
