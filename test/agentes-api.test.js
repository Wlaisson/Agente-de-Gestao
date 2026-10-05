// Testes de ponta a ponta do sistema de agentes pela API HTTP.
//
// Sobem o server.js real (com Supabase e OpenAI mockados, como os demais
// testes de caracterizacao) e exercitam as duas fronteiras: a REST que a
// interface do produto consome e o JSON-RPC A2A que um cliente externo
// consumiria.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/testServer.js';
import { findCallArgs } from './helpers/supabaseMock.js';

let ctx;
const USUARIO = '11111111-1111-1111-1111-111111111111';

before(async () => { ctx = await startTestServer(); });
after(async () => { await ctx.close(); });

// Roteiro de respostas do "modelo": cada chamada consome a proxima entrada.
function roteirizarModelo(passos) {
  let i = 0;
  ctx.openai.setChatHandler(async () => {
    const passo = passos[i++] || { texto: 'fim' };
    if (passo.tools) {
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: passo.tools.map((t, idx) => ({
              id: `call_${i}_${idx}`,
              type: 'function',
              function: { name: t.nome, arguments: JSON.stringify(t.args || {}) }
            }))
          }
        }]
      };
    }
    return { choices: [{ message: { role: 'assistant', content: passo.texto } }] };
  });
}

function comUsuario(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': USUARIO },
    body: JSON.stringify(body)
  };
}

beforeEach(() => {
  // Sem linhas: `obterCliente` cai no cliente global (mockado), e as buscas
  // de atividade devolvem vazio - o que e um cenario legitimo por si.
  ctx.supabaseAdmin.setFromHandler(() => ({ data: null, error: null }));
  ctx.supabase.setFromHandler(() => ({ data: null, error: null }));
});

// --- Descoberta A2A ---------------------------------------------------------

test('GET /.well-known/agent-card.json publica o card do orquestrador', async () => {
  const res = await fetch(`${ctx.baseUrl}/.well-known/agent-card.json`);
  assert.equal(res.status, 200);
  const card = await res.json();
  assert.equal(card.id, 'orquestrador');
  assert.equal(card.protocolVersion, '0.3.0');
  assert.match(card.url, /\/a2a$/);
  assert.ok(Array.isArray(card.skills) && card.skills.length > 0);
});

test('GET /.well-known/agent-cards.json lista todos os agentes registrados', async () => {
  const res = await fetch(`${ctx.baseUrl}/.well-known/agent-cards.json`);
  const { agents } = await res.json();
  const ids = agents.map(a => a.id).sort();
  assert.deepEqual(ids, ['analista', 'orquestrador', 'planejador', 'redator', 'registro']);
});

test('GET /api/agentes lista os cards para a interface', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/agentes`);
  const body = await res.json();
  assert.equal(body.status, 'success');
  const redator = body.agentes.find(a => a.id === 'redator');
  // O card do redator e o que declara os formatos de apresentacao e resumo semanal.
  assert.ok(redator.skills.some(s => s.id === 'weekly-tecnico'));
  assert.ok(redator.skills.some(s => s.id === 'ai-estrategica'));
  assert.ok(redator.skills.some(s => s.id === 'resumo-semana-assunto'));
});


// --- Fronteira REST ---------------------------------------------------------

test('POST /api/agentes/conversar sem identificacao -> 401', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/agentes/conversar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ texto: 'oi' })
  });
  assert.equal(res.status, 401);
});

test('POST /api/agentes/conversar sem texto nem dados -> 400', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/agentes/conversar`, comUsuario({}));
  assert.equal(res.status, 400);
});

test('POST /api/agentes/conversar: resposta direta do orquestrador, sem delegar', async () => {
  roteirizarModelo([{ texto: 'Sou o assistente de gestão. Posso consultar suas atividades.' }]);

  const res = await fetch(`${ctx.baseUrl}/api/agentes/conversar`, comUsuario({ texto: 'quem é você?' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.equal(body.estado, 'completed');
  assert.match(body.texto, /assistente de gestão/);
  assert.equal(body.aguardandoConfirmacao, false);
  assert.ok(body.taskId);
  assert.ok(body.contextId);
});

test('POST /api/agentes/conversar: delega ao analista e devolve a resposta composta', async () => {
  roteirizarModelo([
    // Orquestrador delega.
    { tools: [{ nome: 'delegar_analista', args: { pedido: 'Some o tempo do projeto Rede Pró nesta semana.' } }] },
    // Analista consulta.
    { tools: [{ nome: 'consultar_atividades', args: { periodo: 'esta semana', projeto: 'Rede Pró' } }] },
    // Analista redige.
    { texto: 'Nesta semana você não registrou atividades em Rede Pró.' },
    // Orquestrador compoe.
    { texto: 'Nesta semana você não registrou atividades em Rede Pró.' }
  ]);

  const res = await fetch(`${ctx.baseUrl}/api/agentes/conversar`, comUsuario({
    texto: 'quanto tempo gastei essa semana com a rede pro?'
  }));

  const body = await res.json();
  assert.equal(body.estado, 'completed');
  assert.match(body.texto, /Rede Pró/);
});

test('GET /api/agentes/trace/:contextId expoe a arvore de execucao', async () => {
  roteirizarModelo([
    { tools: [{ nome: 'delegar_analista', args: { pedido: 'x' } }] },
    { texto: 'resposta do analista' },
    { texto: 'resposta final' }
  ]);

  const conversa = await (await fetch(
    `${ctx.baseUrl}/api/agentes/conversar`, comUsuario({ texto: 'o que eu fiz?' })
  )).json();

  const res = await fetch(`${ctx.baseUrl}/api/agentes/trace/${conversa.contextId}`);
  const { spans } = await res.json();

  // O trace e o que permite responder "por que ele disse isso?": precisa
  // conter o agente de entrada e a delegacao.
  assert.ok(spans.length > 0);
  const tipos = JSON.stringify(spans);
  assert.match(tipos, /"tipo":"agente"/);
  assert.match(tipos, /delegar:analista/);
});

// --- Portão de escrita pela API --------------------------------------------

test('POST /api/agentes/conversar: proposta de escrita retorna input-required sem gravar', async () => {
  const escritas = [];
  ctx.supabase.setFromHandler((table, calls) => {
    const upsert = findCallArgs(calls, 'upsert');
    if (table === 'kanban_cards' && upsert) escritas.push(upsert[0]);
    return { data: [], error: null };
  });

  roteirizarModelo([
    { tools: [{ nome: 'delegar_planejador', args: { pedido: 'Criar tarefa "Revisar catálogo Wurth".' } }] },
    { tools: [{ nome: 'propor_criar_tarefa', args: { titulo: 'Revisar catálogo Wurth', projeto: 'Wurth' } }] },
    { texto: 'Preparei a tarefa. Confirma?' },
    { texto: 'Preparei a tarefa "Revisar catálogo Wurth". Confirma?' }
  ]);

  const res = await fetch(`${ctx.baseUrl}/api/agentes/conversar`, comUsuario({
    texto: 'anota uma tarefa pra revisar o catálogo da Wurth'
  }));

  const body = await res.json();
  assert.equal(body.estado, 'input-required');
  assert.equal(body.aguardandoConfirmacao, true);
  assert.equal(body.propostas.length, 1);
  assert.equal(body.propostas[0].tipo, 'criar_tarefa');
  assert.equal(escritas.length, 0, 'nenhuma escrita antes da confirmação');
});

test('POST /api/agentes/confirmar: aplica a proposta pendente', async () => {
  const upserts = [];
  ctx.supabase.setFromHandler((table, calls) => {
    const upsert = findCallArgs(calls, 'upsert');
    if (table === 'kanban_cards' && upsert) upserts.push(upsert[0]);
    return { data: [], error: null };
  });

  roteirizarModelo([
    { tools: [{ nome: 'delegar_planejador', args: { pedido: 'Criar tarefa X.' } }] },
    { tools: [{ nome: 'propor_criar_tarefa', args: { titulo: 'Revisar catálogo Wurth' } }] },
    { texto: 'Confirma?' },
    { texto: 'Confirma?' }
  ]);

  const pendente = await (await fetch(
    `${ctx.baseUrl}/api/agentes/conversar`, comUsuario({ texto: 'anota a tarefa' })
  )).json();
  assert.equal(pendente.estado, 'input-required');

  const res = await fetch(`${ctx.baseUrl}/api/agentes/confirmar`, comUsuario({
    taskId: pendente.taskId,
    confirmar: true
  }));

  const body = await res.json();
  assert.equal(body.estado, 'completed');
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].titulo, 'Revisar catálogo Wurth');
  // A correcao de escopo por usuario: o card nasce com dono.
  assert.equal(upserts[0].user_id, USUARIO);
});

test('POST /api/agentes/confirmar com confirmar=false nao grava', async () => {
  const upserts = [];
  ctx.supabase.setFromHandler((table, calls) => {
    const upsert = findCallArgs(calls, 'upsert');
    if (table === 'kanban_cards' && upsert) upserts.push(upsert[0]);
    return { data: [], error: null };
  });

  roteirizarModelo([
    { tools: [{ nome: 'delegar_planejador', args: { pedido: 'Criar tarefa X.' } }] },
    { tools: [{ nome: 'propor_criar_tarefa', args: { titulo: 'X' } }] },
    { texto: 'Confirma?' },
    { texto: 'Confirma?' }
  ]);

  const pendente = await (await fetch(
    `${ctx.baseUrl}/api/agentes/conversar`, comUsuario({ texto: 'anota' })
  )).json();

  const res = await fetch(`${ctx.baseUrl}/api/agentes/confirmar`, comUsuario({
    taskId: pendente.taskId,
    confirmar: false
  }));

  const body = await res.json();
  assert.equal(body.estado, 'completed');
  assert.equal(upserts.length, 0);
});

// --- Fronteira JSON-RPC A2A -------------------------------------------------

test('POST /a2a sem identificacao -> 401 com envelope JSON-RPC', async () => {
  const res = await fetch(`${ctx.baseUrl}/a2a`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'message/send', params: {} })
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.jsonrpc, '2.0');
  assert.ok(body.error);
});

test('POST /a2a: envelope invalido -> -32600', async () => {
  const res = await fetch(`${ctx.baseUrl}/a2a`, comUsuario({ metodo: 'errado' }));
  const body = await res.json();
  assert.equal(body.error.code, -32600);
});

test('POST /a2a: metodo desconhecido -> -32601', async () => {
  const res = await fetch(`${ctx.baseUrl}/a2a`, comUsuario({
    jsonrpc: '2.0', id: 7, method: 'tasks/inventado', params: {}
  }));
  const body = await res.json();
  assert.equal(body.id, 7);
  assert.equal(body.error.code, -32601);
});

test('POST /a2a message/send devolve uma Task no formato do protocolo', async () => {
  roteirizarModelo([{ texto: 'Resposta do agente.' }]);

  const res = await fetch(`${ctx.baseUrl}/a2a`, comUsuario({
    jsonrpc: '2.0',
    id: 10,
    method: 'message/send',
    params: {
      agentId: 'orquestrador',
      message: { role: 'user', parts: [{ kind: 'text', text: 'oi' }] }
    }
  }));

  const body = await res.json();
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.id, 10);
  assert.equal(body.result.kind, 'task');
  assert.equal(body.result.status.state, 'completed');
  assert.ok(body.result.id);
  // O envelope do protocolo nao carrega estado interno do servidor.
  assert.equal(body.result.userId, undefined);
});

test('POST /a2a: message/send direto a um especialista', async () => {
  roteirizarModelo([{ texto: 'Você não tem tarefas atrasadas.' }]);

  const res = await fetch(`${ctx.baseUrl}/a2a`, comUsuario({
    jsonrpc: '2.0',
    id: 11,
    method: 'message/send',
    params: {
      agentId: 'planejador',
      message: { role: 'user', parts: [{ kind: 'text', text: 'o que está atrasado?' }] }
    }
  }));

  const body = await res.json();
  assert.equal(body.result.metadata.agentId, 'planejador');
});

test('POST /a2a: agente desconhecido -> parametros invalidos', async () => {
  const res = await fetch(`${ctx.baseUrl}/a2a`, comUsuario({
    jsonrpc: '2.0', id: 12, method: 'message/send',
    params: { agentId: 'inexistente', message: { role: 'user', parts: [{ kind: 'text', text: 'x' }] } }
  }));
  const body = await res.json();
  assert.equal(body.error.code, -32602);
});

test('POST /a2a tasks/get: tarefa de outro usuario responde "nao encontrada"', async () => {
  roteirizarModelo([{ texto: 'ok' }]);

  const criada = await (await fetch(`${ctx.baseUrl}/a2a`, comUsuario({
    jsonrpc: '2.0', id: 13, method: 'message/send',
    params: { message: { role: 'user', parts: [{ kind: 'text', text: 'oi' }] } }
  }))).json();

  const res = await fetch(`${ctx.baseUrl}/a2a`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': '22222222-2222-2222-2222-222222222222' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 14, method: 'tasks/get', params: { id: criada.result.id } })
  });

  const body = await res.json();
  // -32001 (tarefa nao encontrada) e nao um erro de permissao: confirmar a
  // existencia do id ja seria vazamento.
  assert.equal(body.error.code, -32001);
});

test('POST /a2a tasks/cancel: tarefa ja concluida nao pode ser cancelada', async () => {
  roteirizarModelo([{ texto: 'ok' }]);

  const criada = await (await fetch(`${ctx.baseUrl}/a2a`, comUsuario({
    jsonrpc: '2.0', id: 15, method: 'message/send',
    params: { message: { role: 'user', parts: [{ kind: 'text', text: 'oi' }] } }
  }))).json();

  const res = await fetch(`${ctx.baseUrl}/a2a`, comUsuario({
    jsonrpc: '2.0', id: 16, method: 'tasks/cancel', params: { id: criada.result.id }
  }));

  const body = await res.json();
  assert.equal(body.error.code, -32002);
});

// --- Voz no chat ------------------------------------------------------------

test('POST /api/agentes/conversar-audio: transcreve e devolve a resposta junto do texto transcrito', async () => {
  // Configurar o mock de transcricao para devolver um texto conhecido.
  ctx.openai.setTranscriptionHandler(async () => ({ text: 'quanto tempo gastei essa semana?' }));

  // Roteiro do modelo (orquestrador responde direto, sem delegar).
  roteirizarModelo([{ texto: 'Nesta semana você registrou 10h no total.' }]);

  // Montar um FormData com um blob de audio falso.
  const { Blob } = await import('node:buffer');
  const audioBlob = new Blob([Buffer.from('audio-fake')], { type: 'audio/webm' });

  const form = new FormData();
  form.append('audio', audioBlob, 'audio.webm');

  const res = await fetch(`${ctx.baseUrl}/api/agentes/conversar-audio`, {
    method: 'POST',
    headers: { 'x-user-id': USUARIO },
    body: form
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.equal(body.estado, 'completed');
  // O texto transcrito DEVE vir separado, para a UI mostrar como bolha do
  // usuario antes de qualquer acao do agente.
  assert.equal(body.textoTranscrito, 'quanto tempo gastei essa semana?');
  assert.match(body.texto, /10h/);
  assert.ok(body.taskId);
  assert.ok(body.contextId);
});

test('POST /api/agentes/conversar-audio sem arquivo -> 400', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/agentes/conversar-audio`, {
    method: 'POST',
    headers: { 'x-user-id': USUARIO, 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
});

test('POST /api/agentes/conversar-audio sem identificacao -> 401', async () => {
  const { Blob } = await import('node:buffer');
  const audioBlob = new Blob([Buffer.from('x')], { type: 'audio/webm' });
  const form = new FormData();
  form.append('audio', audioBlob, 'audio.webm');

  const res = await fetch(`${ctx.baseUrl}/api/agentes/conversar-audio`, {
    method: 'POST',
    body: form
  });
  assert.equal(res.status, 401);
});

test('GET /api/agentes/historico/:contextId devolve as mensagens da conversa', async () => {
  roteirizarModelo([{ texto: 'Primeira resposta.' }]);

  const convRes = await fetch(`${ctx.baseUrl}/api/agentes/conversar`, comUsuario({ texto: 'Olá agente' }));
  const conv = await convRes.json();
  assert.equal(conv.status, 'success');
  assert.ok(conv.contextId);

  const histRes = await fetch(`${ctx.baseUrl}/api/agentes/historico/${conv.contextId}`, {
    headers: { 'x-user-id': USUARIO }
  });
  assert.equal(histRes.status, 200);
  const hist = await histRes.json();
  assert.equal(hist.status, 'success');
  assert.ok(Array.isArray(hist.mensagens));
  assert.ok(hist.mensagens.length >= 2);
  assert.equal(hist.mensagens[0].role, 'user');
  assert.equal(hist.mensagens[0].texto, 'Olá agente');
  assert.equal(hist.mensagens[1].role, 'agent');
  assert.equal(hist.mensagens[1].texto, 'Primeira resposta.');
});

test('GET /api/agentes/historico/:contextId sem autenticacao -> 401', async () => {
  const res = await fetch(`${ctx.baseUrl}/api/agentes/historico/ctx-123`);
  assert.equal(res.status, 401);
});

