// Testes do runtime multiagente: laco de ferramentas, delegacao e - acima de
// tudo - o portao de escrita.
//
// Nenhum servidor HTTP e nenhuma chamada real de modelo: o gateway da OpenAI
// e substituido por um roteiro de respostas, o que torna o comportamento do
// "modelo" deterministico e permite afirmar coisas fortes, do tipo "nada foi
// gravado antes da confirmacao".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAgentRuntime } from '../application/agents/runtime/AgentRuntime.js';
import { createToolExecutor } from '../application/agents/runtime/ToolExecutor.js';
import { createTaskManager } from '../application/agents/runtime/TaskManager.js';
import { createAgentRegistry } from '../application/agents/registry/AgentRegistry.js';
import { criarFerramentasDeDelegacao } from '../application/agents/orchestrator/criarDelegacao.js';
import {
  definirFerramenta,
  resultadoOk,
  resultadoProposta
} from '../application/agents/runtime/definirFerramenta.js';
import { criarAgentCard } from '../domain/a2a/AgentCard.js';
import { mensagemUsuario } from '../domain/a2a/Message.js';
import { ESTADOS_TAREFA } from '../domain/a2a/Task.js';
import { tracerNulo } from '../infrastructure/tracing/Tracer.js';

// --- Dublês -----------------------------------------------------------------

// Gateway que devolve um roteiro de respostas na ordem. Cada entrada e ou
// `{ tools: [{nome, args}] }` (o modelo pede ferramentas) ou `{ texto }`.
function gatewayComRoteiro(roteiro) {
  const chamadas = [];
  let i = 0;
  return {
    chamadas,
    async chamarModelo(params) {
      chamadas.push(params);
      const passo = roteiro[i++];
      if (!passo) return { choices: [{ message: { content: 'fim do roteiro' } }] };
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
    }
  };
}

function repositorioEmMemoria() {
  const mapa = new Map();
  return {
    mapa,
    async salvar(t) { mapa.set(t.id, t); return t; },
    async obter(id) { return mapa.get(id) || null; },
    async listarPorContexto(contextId, userId) {
      return [...mapa.values()]
        .filter(t => t.contextId === contextId && t.userId === userId)
        .sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
    }
  };
}

function montarRuntime(roteiro) {
  const openAIGateway = gatewayComRoteiro(roteiro);
  const toolExecutor = createToolExecutor({ tracer: tracerNulo });
  const agentRuntime = createAgentRuntime({ openAIGateway, toolExecutor, tracer: tracerNulo });
  return { openAIGateway, agentRuntime };
}

const CONFIG_FAKE = { openai: {}, modelos: ['fake'] };

// --- AgentRuntime -----------------------------------------------------------

test('Runtime: executa a ferramenta pedida e devolve o texto final', async () => {
  const vistos = [];
  const ferramenta = definirFerramenta({
    nome: 'somar',
    descricao: 'soma',
    parametros: { type: 'object', properties: { a: { type: 'number' } } },
    executar: async (args, contexto) => {
      vistos.push({ args, contexto });
      return resultadoOk({ total: 42 });
    }
  });

  const { agentRuntime } = montarRuntime([
    { tools: [{ nome: 'somar', args: { a: 1 } }] },
    { texto: 'O total é 42.' }
  ]);

  const r = await agentRuntime.executar({
    agentId: 'teste',
    systemPrompt: 'p',
    mensagens: [{ role: 'user', content: 'soma aí' }],
    ferramentas: [ferramenta],
    contexto: { userId: 'u1' },
    contextId: 'ctx1',
    openAiConfig: CONFIG_FAKE
  });

  assert.equal(r.texto, 'O total é 42.');
  assert.deepEqual(r.ferramentasChamadas, ['somar']);
  assert.equal(r.truncado, false);
  // A identidade chega a ferramenta pelo contexto do servidor, nunca pelos
  // argumentos que o modelo escolheu.
  assert.equal(vistos[0].contexto.userId, 'u1');
  assert.equal(vistos[0].args.userId, undefined);
});

test('Runtime: ferramentas em paralelo numa iteracao so', async () => {
  const ferramenta = definirFerramenta({
    nome: 'consultar',
    descricao: 'c',
    parametros: { type: 'object', properties: { p: { type: 'string' } } },
    executar: async ({ p }) => resultadoOk({ projeto: p })
  });

  const { agentRuntime } = montarRuntime([
    { tools: [{ nome: 'consultar', args: { p: 'A' } }, { nome: 'consultar', args: { p: 'B' } }] },
    { texto: 'pronto' }
  ]);

  const r = await agentRuntime.executar({
    agentId: 'teste', systemPrompt: 'p',
    mensagens: [{ role: 'user', content: 'x' }],
    ferramentas: [ferramenta], contexto: { userId: 'u1' },
    contextId: 'c', openAiConfig: CONFIG_FAKE
  });

  assert.deepEqual(r.ferramentasChamadas, ['consultar', 'consultar']);
});

test('Runtime: erro de ferramenta vira resultado, nao derruba o laco', async () => {
  const ferramenta = definirFerramenta({
    nome: 'quebrada',
    descricao: 'x',
    executar: async () => { throw new Error('banco fora do ar'); }
  });

  const { agentRuntime, openAIGateway } = montarRuntime([
    { tools: [{ nome: 'quebrada', args: {} }] },
    { texto: 'Não consegui consultar agora.' }
  ]);

  const r = await agentRuntime.executar({
    agentId: 'teste', systemPrompt: 'p',
    mensagens: [{ role: 'user', content: 'x' }],
    ferramentas: [ferramenta], contexto: { userId: 'u1' },
    contextId: 'c', openAiConfig: CONFIG_FAKE
  });

  assert.equal(r.texto, 'Não consegui consultar agora.');
  // O modelo recebeu o erro como conteudo de uma mensagem `tool`, e por isso
  // pode se recuperar em vez de o request morrer com 500.
  const ultimaChamada = openAIGateway.chamadas.at(-1);
  const msgTool = ultimaChamada.messages.find(m => m.role === 'tool');
  assert.match(msgTool.content, /banco fora do ar/);
});

test('Runtime: teto de iteracoes trunca em vez de rodar para sempre', async () => {
  const ferramenta = definirFerramenta({
    nome: 'loop', descricao: 'x', executar: async () => resultadoOk({ nada: true })
  });
  // Roteiro que sempre pede ferramenta: sem teto, rodaria indefinidamente.
  const roteiro = Array.from({ length: 20 }, () => ({ tools: [{ nome: 'loop', args: {} }] }));
  const { agentRuntime } = montarRuntime(roteiro);

  const r = await agentRuntime.executar({
    agentId: 'teste', systemPrompt: 'p',
    mensagens: [{ role: 'user', content: 'x' }],
    ferramentas: [ferramenta], contexto: { userId: 'u1' },
    contextId: 'c', openAiConfig: CONFIG_FAKE,
    maxIteracoes: 3
  });

  assert.equal(r.truncado, true);
  assert.equal(r.iteracoes, 3);
});

test('Runtime: na ultima iteracao as ferramentas sao retiradas', async () => {
  const ferramenta = definirFerramenta({
    nome: 'loop', descricao: 'x', executar: async () => resultadoOk({})
  });
  const { agentRuntime, openAIGateway } = montarRuntime([
    { tools: [{ nome: 'loop', args: {} }] },
    { tools: [{ nome: 'loop', args: {} }] }
  ]);

  await agentRuntime.executar({
    agentId: 'teste', systemPrompt: 'p',
    mensagens: [{ role: 'user', content: 'x' }],
    ferramentas: [ferramenta], contexto: { userId: 'u1' },
    contextId: 'c', openAiConfig: CONFIG_FAKE,
    maxIteracoes: 2
  });

  // Forcar a redacao da resposta final: sem isso o modelo pediria uma
  // consulta que nunca seria respondida.
  assert.ok(openAIGateway.chamadas[0].tools);
  assert.equal(openAIGateway.chamadas[1].tools, undefined);
});

// --- Portão de escrita ------------------------------------------------------

function montarTaskManagerComProposta({ roteiro, executores, gravacoes }) {
  const { agentRuntime } = montarRuntime(roteiro);
  const registry = createAgentRegistry();
  const tarefaRepository = repositorioEmMemoria();

  const ferramentaEscrita = definirFerramenta({
    nome: 'propor_criar_tarefa',
    descricao: 'propoe',
    escrita: true,
    parametros: { type: 'object', properties: { titulo: { type: 'string' } } },
    executar: async ({ titulo }) => resultadoProposta({
      tipo: 'criar_tarefa',
      descricao: `Criar "${titulo}"`,
      dados: { titulo }
    })
  });

  registry.registrarLocal({
    card: criarAgentCard({
      id: 'planejador', name: 'Planejador', description: 'd',
      capabilities: { escrita: true }
    }),
    executar: async ({ tarefa, mensagem, contexto, contextId, openAiConfig }) => {
      const r = await agentRuntime.executar({
        agentId: 'planejador', systemPrompt: 'p',
        mensagens: [{ role: 'user', content: 'x' }],
        ferramentas: [ferramentaEscrita],
        contexto, contextId, openAiConfig
      });
      return { texto: r.texto, propostas: r.propostas, truncado: r.truncado };
    }
  });

  const taskManager = createTaskManager({
    agentRegistry: registry,
    tarefaRepository,
    tracer: tracerNulo,
    executoresDeProposta: executores || {
      criar_tarefa: async ({ dados, userId }) => {
        gravacoes.push({ dados, userId });
        return { id: 'card_1' };
      }
    }
  });

  return { taskManager, tarefaRepository };
}

test('Escrita: proposta para a tarefa em input-required e NAO grava nada', async () => {
  const gravacoes = [];
  const { taskManager } = montarTaskManagerComProposta({
    roteiro: [
      { tools: [{ nome: 'propor_criar_tarefa', args: { titulo: 'Revisar catálogo' } }] },
      { texto: 'Preparei a tarefa. Confirma?' }
    ],
    gravacoes
  });

  const tarefa = await taskManager.enviarMensagem({
    agentId: 'planejador',
    mensagem: mensagemUsuario('anota pra revisar o catálogo'),
    userId: 'u1',
    openAiConfig: CONFIG_FAKE
  });

  assert.equal(tarefa.status.state, ESTADOS_TAREFA.AGUARDANDO_ENTRADA);
  assert.equal(tarefa.metadata.propostasPendentes.length, 1);
  assert.equal(tarefa.metadata.propostasPendentes[0].tipo, 'criar_tarefa');
  // A invariante central do sistema.
  assert.equal(gravacoes.length, 0, 'nada pode ser gravado antes da confirmação');
});

test('Escrita: confirmacao estruturada executa a proposta exatamente como aprovada', async () => {
  const gravacoes = [];
  const { taskManager } = montarTaskManagerComProposta({
    roteiro: [
      { tools: [{ nome: 'propor_criar_tarefa', args: { titulo: 'Revisar catálogo' } }] },
      { texto: 'Confirma?' }
    ],
    gravacoes
  });

  const pendente = await taskManager.enviarMensagem({
    agentId: 'planejador',
    mensagem: mensagemUsuario('anota aí'),
    userId: 'u1',
    openAiConfig: CONFIG_FAKE
  });

  const confirmacao = mensagemUsuario('Confirmo.', { taskId: pendente.id });
  confirmacao.parts.push({ kind: 'data', data: { confirmar: true } });

  const concluida = await taskManager.enviarMensagem({
    agentId: 'planejador',
    mensagem: confirmacao,
    taskId: pendente.id,
    userId: 'u1',
    openAiConfig: CONFIG_FAKE
  });

  assert.equal(concluida.status.state, ESTADOS_TAREFA.CONCLUIDA);
  assert.equal(gravacoes.length, 1);
  // Grava os dados da proposta aprovada, nao uma nova saida do modelo.
  assert.equal(gravacoes[0].dados.titulo, 'Revisar catálogo');
  assert.equal(gravacoes[0].userId, 'u1');
  assert.deepEqual(concluida.metadata.propostasPendentes, []);
});

test('Escrita: recusa descarta a proposta sem gravar', async () => {
  const gravacoes = [];
  const { taskManager } = montarTaskManagerComProposta({
    roteiro: [
      { tools: [{ nome: 'propor_criar_tarefa', args: { titulo: 'X' } }] },
      { texto: 'Confirma?' }
    ],
    gravacoes
  });

  const pendente = await taskManager.enviarMensagem({
    agentId: 'planejador', mensagem: mensagemUsuario('anota'), userId: 'u1', openAiConfig: CONFIG_FAKE
  });

  const recusa = mensagemUsuario('Não', { taskId: pendente.id });
  const final = await taskManager.enviarMensagem({
    agentId: 'planejador', mensagem: recusa, taskId: pendente.id, userId: 'u1', openAiConfig: CONFIG_FAKE
  });

  assert.equal(final.status.state, ESTADOS_TAREFA.CONCLUIDA);
  assert.equal(gravacoes.length, 0);
  assert.deepEqual(final.metadata.propostasPendentes, []);
});

test('Escrita: resposta ambigua ("sim, mas...") descarta a proposta antiga', async () => {
  const gravacoes = [];
  const { taskManager } = montarTaskManagerComProposta({
    roteiro: [
      { tools: [{ nome: 'propor_criar_tarefa', args: { titulo: 'Título errado' } }] },
      { texto: 'Confirma?' },
      // Reexecucao apos a instrucao nova.
      { tools: [{ nome: 'propor_criar_tarefa', args: { titulo: 'Título corrigido' } }] },
      { texto: 'Corrigi. Confirma agora?' }
    ],
    gravacoes
  });

  const pendente = await taskManager.enviarMensagem({
    agentId: 'planejador', mensagem: mensagemUsuario('anota'), userId: 'u1', openAiConfig: CONFIG_FAKE
  });

  const correcao = mensagemUsuario('sim, mas muda o título para Título corrigido', { taskId: pendente.id });
  const novo = await taskManager.enviarMensagem({
    agentId: 'planejador', mensagem: correcao, taskId: pendente.id, userId: 'u1', openAiConfig: CONFIG_FAKE
  });

  // A proposta ERRADA nunca foi gravada; uma nova foi proposta em seu lugar.
  assert.equal(gravacoes.length, 0);
  assert.equal(novo.status.state, ESTADOS_TAREFA.AGUARDANDO_ENTRADA);
  assert.equal(novo.metadata.propostasPendentes[0].dados.titulo, 'Título corrigido');
});

test('Escrita: falha do executor marca a tarefa como failed e nao mente para o usuario', async () => {
  const { taskManager } = montarTaskManagerComProposta({
    roteiro: [
      { tools: [{ nome: 'propor_criar_tarefa', args: { titulo: 'X' } }] },
      { texto: 'Confirma?' }
    ],
    executores: {
      criar_tarefa: async () => { throw new Error('Supabase indisponível'); }
    }
  });

  const pendente = await taskManager.enviarMensagem({
    agentId: 'planejador', mensagem: mensagemUsuario('anota'), userId: 'u1', openAiConfig: CONFIG_FAKE
  });

  const confirmacao = mensagemUsuario('sim', { taskId: pendente.id });
  const final = await taskManager.enviarMensagem({
    agentId: 'planejador', mensagem: confirmacao, taskId: pendente.id, userId: 'u1', openAiConfig: CONFIG_FAKE
  });

  assert.equal(final.status.state, ESTADOS_TAREFA.FALHOU);
  assert.match(final.status.message.parts[0].text, /Supabase indisponível/);
});

// --- Escopo por usuário -----------------------------------------------------

test('Escopo: outro usuario nao acessa nem continua a tarefa alheia', async () => {
  const gravacoes = [];
  const { taskManager } = montarTaskManagerComProposta({
    roteiro: [
      { tools: [{ nome: 'propor_criar_tarefa', args: { titulo: 'X' } }] },
      { texto: 'Confirma?' }
    ],
    gravacoes
  });

  const pendente = await taskManager.enviarMensagem({
    agentId: 'planejador', mensagem: mensagemUsuario('anota'), userId: 'u1', openAiConfig: CONFIG_FAKE
  });

  // Leitura por terceiro.
  await assert.rejects(
    () => taskManager.obterTarefa({ taskId: pendente.id, userId: 'u2' }),
    /Tarefa nao encontrada/
  );

  // Confirmacao por terceiro: seria a escalada mais grave - aprovar uma
  // escrita na conta de outra pessoa.
  const confirmacao = mensagemUsuario('sim', { taskId: pendente.id });
  await assert.rejects(
    () => taskManager.enviarMensagem({
      agentId: 'planejador', mensagem: confirmacao, taskId: pendente.id, userId: 'u2', openAiConfig: CONFIG_FAKE
    }),
    /Tarefa nao encontrada/
  );
  assert.equal(gravacoes.length, 0);
});

test('Escopo: mensagem sem userId e recusada', async () => {
  const { taskManager } = montarTaskManagerComProposta({ roteiro: [{ texto: 'oi' }], gravacoes: [] });
  await assert.rejects(
    () => taskManager.enviarMensagem({
      agentId: 'planejador', mensagem: mensagemUsuario('oi'), userId: null, openAiConfig: CONFIG_FAKE
    }),
    /Identificação do usuário ausente/
  );
});

// --- Delegação --------------------------------------------------------------

test('Delegacao: ferramentas sao derivadas dos agent cards do registry', async () => {
  const registry = createAgentRegistry();
  registry.registrarLocal({
    card: criarAgentCard({
      id: 'analista', name: 'Analista', description: 'Consulta dados.',
      skills: [{ id: 's1', name: 'Tempo', description: 'Soma tempo', examples: ['quanto tempo?'] }]
    }),
    executar: async () => ({ texto: 'ok', propostas: [] })
  });
  registry.registrarLocal({
    card: criarAgentCard({ id: 'orquestrador', name: 'Orq', description: 'x' }),
    executar: async () => ({ texto: '', propostas: [] })
  });

  const ferramentas = criarFerramentasDeDelegacao({
    agentRegistry: registry,
    orquestradorId: 'orquestrador',
    tarefaRepository: repositorioEmMemoria(),
    tracer: tracerNulo
  });

  // O orquestrador nao aparece na propria lista - delegar para si mesmo e
  // recursao infinita.
  assert.equal(ferramentas.length, 1);
  assert.equal(ferramentas[0].nome, 'delegar_analista');
  // A descricao carrega as skills e exemplos do card: e o que o modelo usa
  // para rotear.
  assert.match(ferramentas[0].descricao, /Soma tempo/);
  assert.match(ferramentas[0].descricao, /quanto tempo\?/);
});

test('Delegacao: propostas de um especialista sobem ate o orquestrador', async () => {
  const registry = createAgentRegistry();
  const tarefaRepository = repositorioEmMemoria();

  registry.registrarLocal({
    card: criarAgentCard({
      id: 'planejador', name: 'Planejador', description: 'd', capabilities: { escrita: true }
    }),
    executar: async () => ({
      texto: 'Preparei a tarefa.',
      propostas: [{ tipo: 'criar_tarefa', descricao: 'Criar X', dados: { titulo: 'X' }, impacto: 'baixo' }]
    })
  });
  registry.registrarLocal({
    card: criarAgentCard({ id: 'orquestrador', name: 'Orq', description: 'x' }),
    executar: async () => ({ texto: '', propostas: [] })
  });

  const ferramentas = criarFerramentasDeDelegacao({
    agentRegistry: registry, orquestradorId: 'orquestrador', tarefaRepository, tracer: tracerNulo
  });

  const { agentRuntime } = montarRuntime([
    { tools: [{ nome: 'delegar_planejador', args: { pedido: 'cria a tarefa X' } }] },
    { texto: 'Preparei. Confirma?' }
  ]);

  const r = await agentRuntime.executar({
    agentId: 'orquestrador', systemPrompt: 'p',
    mensagens: [{ role: 'user', content: 'cria tarefa' }],
    ferramentas, contexto: { userId: 'u1', contextId: 'ctx1', taskId: 't1', openAiConfig: CONFIG_FAKE },
    contextId: 'ctx1', openAiConfig: CONFIG_FAKE
  });

  // A confirmacao acontece uma unica vez, no nivel que fala com o usuario,
  // mesmo quando a escrita nasceu um nivel abaixo.
  assert.equal(r.propostas.length, 1);
  assert.equal(r.propostas[0].tipo, 'criar_tarefa');
});

test('Delegacao: sub-tarefa e criada no mesmo contexto, com parentTaskId', async () => {
  const registry = createAgentRegistry();
  const tarefaRepository = repositorioEmMemoria();

  registry.registrarLocal({
    card: criarAgentCard({ id: 'analista', name: 'A', description: 'd' }),
    executar: async () => ({ texto: 'resposta do analista', propostas: [] })
  });
  registry.registrarLocal({
    card: criarAgentCard({ id: 'orquestrador', name: 'O', description: 'x' }),
    executar: async () => ({ texto: '', propostas: [] })
  });

  const [delegar] = criarFerramentasDeDelegacao({
    agentRegistry: registry, orquestradorId: 'orquestrador', tarefaRepository, tracer: tracerNulo
  });

  const r = await delegar.executar(
    { pedido: 'quanto tempo na RedePRO?' },
    { userId: 'u1', contextId: 'ctx-abc', taskId: 'task-pai', openAiConfig: CONFIG_FAKE }
  );

  assert.equal(r.ok, true);
  assert.equal(r.resposta, 'resposta do analista');

  const subTarefas = [...tarefaRepository.mapa.values()];
  assert.equal(subTarefas.length, 1);
  assert.equal(subTarefas[0].contextId, 'ctx-abc');
  assert.equal(subTarefas[0].metadata.parentTaskId, 'task-pai');
  assert.equal(subTarefas[0].status.state, ESTADOS_TAREFA.CONCLUIDA);
});

test('Delegacao: falha do especialista vira erro tratado, sem derrubar o orquestrador', async () => {
  const registry = createAgentRegistry();
  registry.registrarLocal({
    card: criarAgentCard({ id: 'analista', name: 'A', description: 'd' }),
    executar: async () => { throw new Error('especialista fora do ar'); }
  });
  registry.registrarLocal({
    card: criarAgentCard({ id: 'orquestrador', name: 'O', description: 'x' }),
    executar: async () => ({ texto: '', propostas: [] })
  });

  const [delegar] = criarFerramentasDeDelegacao({
    agentRegistry: registry, orquestradorId: 'orquestrador',
    tarefaRepository: repositorioEmMemoria(), tracer: tracerNulo
  });

  const r = await delegar.executar(
    { pedido: 'x' },
    { userId: 'u1', contextId: 'c', taskId: 't', openAiConfig: CONFIG_FAKE }
  );

  assert.equal(r.ok, false);
  assert.match(r.erro, /especialista fora do ar/);
  // Instrucao explicita para o orquestrador nao inventar o conteudo que
  // faltou.
  assert.match(r.sugestao, /Não invente/);
});

// --- Memória da conversa ----------------------------------------------------

// Helper: monta um TaskManager simples (sem escrita) para os testes de
// historico. O agente responde com o texto do roteiro e nao chama ferramentas.
function montarTaskManagerSimples(roteiros) {
  let indiceRoteiro = 0;
  const registry = createAgentRegistry();
  const tarefaRepository = repositorioEmMemoria();

  registry.registrarLocal({
    card: criarAgentCard({ id: 'eco', name: 'Eco', description: 'repete' }),
    executar: async ({ tarefa, mensagem }) => {
      const texto = roteiros[indiceRoteiro++] || 'fim';
      return { texto, propostas: [], truncado: false };
    }
  });

  const taskManager = createTaskManager({
    agentRegistry: registry,
    tarefaRepository,
    tracer: tracerNulo,
    executoresDeProposta: {}
  });

  return { taskManager, tarefaRepository, registry };
}

test('Memoria: segunda mensagem no mesmo contextId recebe o historico da primeira', async () => {
  const { taskManager } = montarTaskManagerSimples([
    'Você gastou 6h15 na Imdepa esta semana.',
    'Na Tracbel foram 3h20.'
  ]);

  // Primeira mensagem - cria o contexto.
  const t1 = await taskManager.enviarMensagem({
    agentId: 'eco',
    mensagem: mensagemUsuario('quanto tempo gastei essa semana na Imdepa?'),
    userId: 'u1',
    openAiConfig: CONFIG_FAKE
  });
  assert.equal(t1.status.state, ESTADOS_TAREFA.CONCLUIDA);
  const ctx = t1.contextId;

  // Segunda mensagem - reutiliza o contextId.
  const t2 = await taskManager.enviarMensagem({
    agentId: 'eco',
    mensagem: mensagemUsuario('e na Tracbel?'),
    contextId: ctx,
    userId: 'u1',
    openAiConfig: CONFIG_FAKE
  });
  assert.equal(t2.status.state, ESTADOS_TAREFA.CONCLUIDA);

  // A segunda tarefa deve conter o historico completo: as mensagens da
  // primeira tarefa (user + agent) mais a mensagem nova do usuario e a
  // resposta do agente.
  const roles = t2.history.map(m => m.role);
  // Historico anterior (user, agent) + mensagem nova (user) + resposta (agent)
  assert.ok(roles.length >= 4, `Esperava >= 4 mensagens, recebeu ${roles.length}`);
  // As primeiras mensagens devem ser do historico anterior.
  assert.equal(roles[0], 'user');
  assert.equal(roles[1], 'agent');
});

test('Memoria: sub-tarefa de delegacao NAO aparece no historico do orquestrador', async () => {
  const registry = createAgentRegistry();
  const tarefaRepository = repositorioEmMemoria();

  // Especialista que cria sub-tarefas com parentTaskId no metadata.
  registry.registrarLocal({
    card: criarAgentCard({ id: 'analista', name: 'Analista', description: 'd' }),
    executar: async () => ({ texto: 'resposta do analista', propostas: [] })
  });
  registry.registrarLocal({
    card: criarAgentCard({ id: 'orquestrador', name: 'Orq', description: 'x' }),
    executar: async () => ({ texto: '', propostas: [] })
  });

  // Simular uma conversa completa no turno 1: tarefa do orquestrador + sub-tarefa
  // do analista, ambas no mesmo contextId.
  const { criarTarefa: criar, transicionar: trans, ESTADOS_TAREFA: EST } = await import('../domain/a2a/Task.js');
  const { mensagemAgente: msgAg } = await import('../domain/a2a/Message.js');

  const ctxId = 'ctx-filtro-teste';

  // Tarefa de topo (orquestrador) - primeira mensagem.
  let tarefaTopo = criar({
    id: 'task-topo-1',
    contextId: ctxId,
    agentId: 'orquestrador',
    userId: 'u1',
    mensagemInicial: mensagemUsuario('quanto tempo essa semana?')
  });
  tarefaTopo = trans(tarefaTopo, EST.TRABALHANDO);
  tarefaTopo = trans(tarefaTopo, EST.CONCLUIDA, {
    message: msgAg('Voce gastou 10h no total.')
  });
  await tarefaRepository.salvar(tarefaTopo);

  // Sub-tarefa de delegacao ao analista (tem parentTaskId).
  let subTarefa = criar({
    id: 'task-sub-1',
    contextId: ctxId,
    agentId: 'analista',
    userId: 'u1',
    mensagemInicial: mensagemUsuario('some o tempo de u1 nesta semana'),
    metadata: { parentTaskId: 'task-topo-1', delegadoPor: 'orquestrador' }
  });
  subTarefa = trans(subTarefa, EST.TRABALHANDO);
  subTarefa = trans(subTarefa, EST.CONCLUIDA, {
    message: msgAg('Total: 10h.')
  });
  await tarefaRepository.salvar(subTarefa);

  // Agora o TaskManager cria uma nova tarefa no mesmo contexto (turno 2).
  const { agentRuntime } = montarRuntime([{ texto: 'Resposta do turno 2' }]);
  registry.registrarLocal({
    card: criarAgentCard({ id: 'eco2', name: 'Eco2', description: 'x' }),
    executar: async ({ tarefa }) => {
      // Verificar que o historico da tarefa NAO contem mensagens da sub-tarefa.
      const textos = tarefa.history.map(m => {
        const part = m.parts?.find(p => p.kind === 'text');
        return part?.text || '';
      });
      // A sub-tarefa tinha "some o tempo de u1 nesta semana" como mensagem.
      // Essa mensagem NAO pode aparecer no historico do turno 2.
      const temMsgDelegacao = textos.some(t => t.includes('some o tempo'));
      assert.equal(temMsgDelegacao, false,
        'Mensagem da sub-tarefa de delegacao vazou para o historico do orquestrador');
      return { texto: 'ok', propostas: [], truncado: false };
    }
  });

  const taskManager = createTaskManager({
    agentRegistry: registry,
    tarefaRepository,
    tracer: tracerNulo,
    executoresDeProposta: {}
  });

  const t2 = await taskManager.enviarMensagem({
    agentId: 'eco2',
    mensagem: mensagemUsuario('e na Tracbel?'),
    contextId: ctxId,
    userId: 'u1',
    openAiConfig: CONFIG_FAKE
  });

  // A tarefa do turno 2 deve ter o historico da tarefa de TOPO (user + agent),
  // mas nao as mensagens da sub-tarefa.
  assert.equal(t2.status.state, ESTADOS_TAREFA.CONCLUIDA);
  // Historico: 2 msgs da tarefa de topo + 1 msg nova + 1 resposta = 4
  // (Sub-tarefa tinha 2 msgs que NAO devem aparecer.)
  const msgsUser = t2.history.filter(m => m.role === 'user');
  const msgsAgent = t2.history.filter(m => m.role === 'agent');
  assert.ok(msgsUser.length >= 2, 'Deve ter pelo menos 2 mensagens de usuario');
  assert.ok(msgsAgent.length >= 1, 'Deve ter pelo menos 1 resposta de agente');
});

test('Memoria: historico respeita o teto de MAX_MENSAGENS_HISTORICO (12)', async () => {
  const registry = createAgentRegistry();
  const tarefaRepository = repositorioEmMemoria();

  const { criarTarefa: criar, transicionar: trans, ESTADOS_TAREFA: EST } = await import('../domain/a2a/Task.js');
  const { mensagemAgente: msgAg } = await import('../domain/a2a/Message.js');

  const ctxId = 'ctx-teto-teste';

  // Criar 8 tarefas anteriores no mesmo contexto, cada uma com 2 mensagens
  // (user + agent) = 16 mensagens no total, acima do teto de 12.
  for (let i = 0; i < 8; i++) {
    let t = criar({
      id: `task-hist-${i}`,
      contextId: ctxId,
      agentId: 'eco',
      userId: 'u1',
      mensagemInicial: mensagemUsuario(`pergunta ${i}`)
    });
    t = trans(t, EST.TRABALHANDO);
    t = trans(t, EST.CONCLUIDA, {
      message: msgAg(`resposta ${i}`)
    });
    await tarefaRepository.salvar(t);
  }

  // Registrar um agente que captura as mensagens que recebe.
  let mensagensRecebidas = [];
  registry.registrarLocal({
    card: criarAgentCard({ id: 'inspetor', name: 'Inspetor', description: 'x' }),
    executar: async ({ tarefa }) => {
      mensagensRecebidas = tarefa.history;
      return { texto: 'ok', propostas: [], truncado: false };
    }
  });

  const taskManager = createTaskManager({
    agentRegistry: registry,
    tarefaRepository,
    tracer: tracerNulo,
    executoresDeProposta: {}
  });

  await taskManager.enviarMensagem({
    agentId: 'inspetor',
    mensagem: mensagemUsuario('pergunta nova'),
    contextId: ctxId,
    userId: 'u1',
    openAiConfig: CONFIG_FAKE
  });

  // O historico da tarefa tera todas as mensagens (16 anteriores + 1 nova = 17),
  // mas criarAgenteLlm.reconstruirMensagens corta em MAX_MENSAGENS_HISTORICO = 12.
  // Aqui validamos que o TaskManager carregou o historico e que o teto de 12
  // funciona no ponto certo (reconstruirMensagens).
  //
  // A tarefa recebe o historico completo (para persistir); o corte e na
  // conversao para o prompt do modelo.
  assert.ok(mensagensRecebidas.length > 12,
    `Historico carregado deveria ter > 12 msgs (tem ${mensagensRecebidas.length})`);

  // Agora testar que reconstruirMensagens respeita o teto.
  const { criarAgenteLlm } = await import('../application/agents/runtime/criarAgenteLlm.js');
  const { agentRuntime } = montarRuntime([{ texto: 'ok' }]);

  let mensagensDoModelo = [];
  const agenteTeste = criarAgenteLlm({
    card: criarAgentCard({ id: 'teste-teto', name: 'T', description: 'x' }),
    montarPrompt: async () => 'prompt',
    ferramentas: [],
    agentRuntime: {
      executar: async (params) => {
        mensagensDoModelo = params.mensagens;
        return { texto: 'ok', propostas: [], ferramentasChamadas: [], truncado: false };
      }
    }
  });

  // Simular uma tarefa com historico grande.
  const msgAtual = mensagemUsuario('pergunta nova');
  const tarefaGrande = {
    history: mensagensRecebidas,
    id: 'task-grande'
  };

  await agenteTeste.executar({
    tarefa: tarefaGrande,
    mensagem: msgAtual,
    contexto: { userId: 'u1' },
    contextId: ctxId,
    openAiConfig: CONFIG_FAKE
  });

  // reconstruirMensagens corta em 12 do historico (slice(-12)), e a mensagem
  // atual e incluida separadamente. O total de mensagens do modelo deve ser <= 13
  // (12 do historico + 1 atual).
  assert.ok(mensagensDoModelo.length <= 13,
    `Modelo deveria receber <= 13 msgs, recebeu ${mensagensDoModelo.length}`);
});
