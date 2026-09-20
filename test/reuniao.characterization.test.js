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

test('POST /api/processar-reuniao: injeta contexto RAG recuperado via busca semantica no prompt', async () => {
  ctx.supabaseAdmin.setRpcHandler((fnName) => {
    if (fnName === 'match_atividades') {
      return { data: [{ id: 'A-1', titulo: 'Manutenção no sistema Prosis', assunto_interno: 'Prosis', projeto: 'Interno' }], error: null };
    }
    if (fnName === 'match_kanban_cards') {
      return { data: [{ id: 'K-1', titulo: 'Investigar erro 401', status: 'Em Andamento', assunto_interno: 'Prosis' }], error: null };
    }
    return { data: [], error: null };
  });

  let promptEnviado = '';
  ctx.openai.setChatHandler(async (params) => {
    promptEnviado = params.messages[0].content;
    return { choices: [{ message: { content: JSON.stringify({ nome_reuniao: 'Daily', data_reuniao: '2026-01-05', resumo_geral: '', minhas_tarefas: [] }) } }] };
  });

  const res = await fetch(`${ctx.baseUrl}/api/processar-reuniao`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nome_reuniao: 'Daily', data_reuniao: '2026-01-05', transcricao: 'Precisamos investigar aquele erro 401 no Prosis' })
  });
  assert.equal(res.status, 200);
  assert.match(promptEnviado, /Manutenção no sistema Prosis/);
  assert.match(promptEnviado, /Investigar erro 401/);
});

test('POST /api/processar-reuniao: campo "raciocinio" do chain-of-thought oculto nunca aparece na resposta', async () => {
  ctx.supabaseAdmin.setRpcHandler(() => ({ data: [], error: null }));
  ctx.openai.setChatHandler(async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          raciocinio: 'Passo 1: analisei a transcrição. Passo 2: nenhuma tarefa foi atribuída a mim.',
          nome_reuniao: 'Daily',
          data_reuniao: '2026-01-05',
          resumo_geral: 'Resumo sem tarefas.',
          minhas_tarefas: []
        })
      }
    }]
  }));

  const res = await fetch(`${ctx.baseUrl}/api/processar-reuniao`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nome_reuniao: 'Daily', data_reuniao: '2026-01-05', transcricao: 'texto qualquer' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal('raciocinio' in body, false);
  assert.deepEqual(Object.keys(body).sort(), ['data_reuniao', 'minhas_tarefas', 'nome_reuniao', 'resumo_geral']);
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
