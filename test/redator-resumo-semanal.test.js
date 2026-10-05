import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_REDATOR, criarRedatorAgent } from '../application/agents/redator/RedatorAgent.js';
import { ESPECIFICACAO_FORMATOS, REDATOR_NEGATIVAS, REDATOR_PERSONA } from '../application/agents/redator/redatorPromptConfig.js';
import { CARD_ORQUESTRADOR, criarOrquestradorAgent } from '../application/agents/orchestrator/OrchestratorAgent.js';
import { definirFerramenta, resultadoOk } from '../application/agents/runtime/definirFerramenta.js';
import { createAgentRegistry } from '../application/agents/registry/AgentRegistry.js';
import { createTaskManager } from '../application/agents/runtime/TaskManager.js';
import { mensagemUsuario } from '../domain/a2a/Message.js';

const CONFIG_FAKE = { openai: {}, modelos: ['fake'] };

const tracerNulo = {
  iniciarSpan: () => ({ finalizar: () => {}, id: 'span-fake' }),
  obterArvore: () => []
};

function montarRuntime(roteiro) {
  let passo = 0;
  const chamadasAoModelo = [];

  const openAIGateway = {
    chamarModelo: async (params) => {
      chamadasAoModelo.push(params);
      const atual = roteiro[passo++];
      if (!atual) throw new Error(`Roteiro esgotado no passo ${passo}`);

      if (atual.tools) {
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: atual.tools.map((t, idx) => ({
                id: `call_${passo}_${idx}`,
                type: 'function',
                function: { name: t.nome, arguments: JSON.stringify(t.args || {}) }
              }))
            }
          }]
        };
      }

      return {
        choices: [{
          message: { role: 'assistant', content: atual.texto || '' }
        }]
      };
    }
  };

  const toolExecutor = {
    executar: async ({ ferramenta, parametros, contexto }) => ferramenta.executar(parametros, contexto)
  };

  return { openAIGateway, toolExecutor, chamadasAoModelo };
}

function repositorioEmMemoria() {
  const mapa = new Map();
  return {
    async salvar(tarefa) {
      mapa.set(tarefa.id, JSON.parse(JSON.stringify(tarefa)));
      return tarefa;
    },
    async obter(id) {
      const t = mapa.get(id);
      return t ? JSON.parse(JSON.stringify(t)) : null;
    },
    async listarPorContexto(contextId, userId) {
      return [...mapa.values()]
        .filter(t => t.contextId === contextId && t.userId === userId)
        .sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)))
        .map(t => JSON.parse(JSON.stringify(t)));
    }
  };
}

// ---------------------------------------------------------------------------
// Testes do Redator: Resumo da Semana por Assunto (Sexta-feira)
// ---------------------------------------------------------------------------

test('Redator: card declara a skill de Resumo da Semana por Assunto', () => {
  const skill = CARD_REDATOR.skills.find(s => s.id === 'resumo-semana-assunto');
  assert.ok(skill, 'Deve ter a skill resumo-semana-assunto');
  assert.match(skill.description, /desenvolvimento e construção/i);
  assert.match(skill.description, /reuniões/i);
  assert.ok(skill.examples.some(e => e.includes('resumo da semana')));
});

test('Redator: especificacao de formatos contem regras estritas para o Formato 3', () => {
  assert.match(ESPECIFICACAO_FORMATOS, /FORMATO 3 — RESUMO DA SEMANA POR ASSUNTO/);
  assert.match(ESPECIFICACAO_FORMATOS, /reunião/i);
  assert.match(ESPECIFICACAO_FORMATOS, /atualização de apresentação/i);
  assert.match(ESPECIFICACAO_FORMATOS, /desenvolvimento e construção/i);
  assert.match(ESPECIFICACAO_FORMATOS, /Rede Pró/i);
  assert.match(ESPECIFICACAO_FORMATOS, /Agrominas/i);
});

test('Redator: negativas do prompt proibem reunioes e atualizacao de apresentacao no Formato 3', () => {
  const temNegativaReuniao = REDATOR_NEGATIVAS.some(n =>
    n.includes('Resumo da Semana por Assunto') && n.includes('reuniões') && n.includes('atualização de apresentação')
  );
  assert.ok(temNegativaReuniao, 'Deve ter negativa expressa contra reuniões e atualização de apresentação no Formato 3');

  const temOmiteAssuntoVazio = REDATOR_NEGATIVAS.some(n =>
    n.includes('Resumo da Semana por Assunto') && n.includes('omita esse assunto por completo')
  );
  assert.ok(temOmiteAssuntoVazio, 'Deve orientar a omitir assuntos que só tinham reuniões');
});

test('Redator: execucao para resumo da semana consulta atividades e gera texto consolidado', async () => {
  const atividadesConsultadas = [];
  const ferramentaConsulta = definirFerramenta({
    nome: 'consultar_atividades',
    descricao: 'consulta',
    parametros: { type: 'object', properties: { periodo: { type: 'string' } } },
    executar: async (args) => {
      atividadesConsultadas.push(args);
      return resultadoOk({
        periodo: '28/09 a 04/10',
        quantidadeTotal: 4,
        atividades: [
          {
            id: '1',
            titulo: 'Daily Meeting',
            descricao: 'Reunião diária de alinhamento com o time.',
            assunto: 'Gestão Interna',
            projeto: 'Interno'
          },
          {
            id: '2',
            titulo: 'Construção de Memória Conversacional',
            descricao: 'Desenvolvida a persistência em banco e fallback de histórico.',
            assunto: 'Agente de Gestão',
            projeto: 'Interno'
          },
          {
            id: '3',
            titulo: 'Ingestão de SKUs N2',
            descricao: 'Criada a pipeline automatizada de produtos N2.',
            assunto: 'Catálogo',
            projeto: 'Projetos - Rede Pró'
          },
          {
            id: '4',
            titulo: 'Atualização de apresentação semanal',
            descricao: 'Slides atualizados para alinhamento.',
            assunto: 'Gestão Interna',
            projeto: 'Interno'
          }
        ]
      });
    }
  });

  const textoFinalEsperado = `**RESUMO DA SEMANA — 28/09 a 04/10**

**[Agente de Gestão]**
- **[Memória Conversacional]:** Desenvolvida a persistência em banco e fallback de histórico entre turnos.

**[Projetos - Rede Pró]**
- **[Automação de Catálogo]:** Criada a pipeline automatizada de produtos N2.`;

  const { openAIGateway, toolExecutor, chamadasAoModelo } = montarRuntime([
    { tools: [{ nome: 'consultar_atividades', args: { periodo: 'esta semana' } }] },
    { texto: textoFinalEsperado }
  ]);

  const { createAgentRuntime } = await import('../application/agents/runtime/AgentRuntime.js');
  const agentRuntime = createAgentRuntime({ openAIGateway, toolExecutor, tracer: tracerNulo });

  const redator = criarRedatorAgent({
    ferramentas: [ferramentaConsulta],
    agentRuntime
  });

  const resposta = await redator.executar({
    tarefa: { id: 'task-1', userId: 'u1' },
    mensagem: mensagemUsuario('gera o resumo da semana por assunto para envio de sexta'),
    contexto: { userId: 'u1' },
    contextId: 'ctx-resumo',
    openAiConfig: CONFIG_FAKE
  });

  assert.equal(atividadesConsultadas.length, 1);
  assert.equal(resposta.texto, textoFinalEsperado);
  assert.deepEqual(resposta.dados.ferramentasUsadas, ['consultar_atividades']);

  // Validar que o system prompt enviado ao modelo continha as instrucoes do Formato 3
  const systemPrompt = chamadasAoModelo[0].messages.find(m => m.role === 'system').content;
  assert.match(systemPrompt, /FORMATO 3 — RESUMO DA SEMANA POR ASSUNTO/);
  assert.match(systemPrompt, /reuniões/i);
});

// ---------------------------------------------------------------------------
// Testes do Orquestrador: Memória e Delegação de Resumo
// ---------------------------------------------------------------------------

test('Orquestrador: delega para redator quando usuario pede resumo da semana por assunto', async () => {
  const chamadasRedator = [];
  const delegarRedator = definirFerramenta({
    nome: 'delegar_redator',
    descricao: 'delega',
    parametros: { type: 'object', properties: { pedido: { type: 'string' } } },
    executar: async (args) => {
      chamadasRedator.push(args);
      return resultadoOk({
        agente: 'redator',
        resposta: '**RESUMO DA SEMANA — 28/09 a 04/10**\n\n**[Agente de Gestão]**\n- **[Arquitetura]:** Implementação concluída.'
      });
    }
  });

  const { openAIGateway, toolExecutor } = montarRuntime([
    { tools: [{ nome: 'delegar_redator', args: { pedido: 'Gere o Resumo da Semana por Assunto para envio de sexta-feira cobrindo desenvolvimento e construção.' } }] },
    { texto: '**RESUMO DA SEMANA — 28/09 a 04/10**\n\n**[Agente de Gestão]**\n- **[Arquitetura]:** Implementação concluída.' }
  ]);

  const { createAgentRuntime } = await import('../application/agents/runtime/AgentRuntime.js');
  const agentRuntime = createAgentRuntime({ openAIGateway, toolExecutor, tracer: tracerNulo });

  const orquestrador = criarOrquestradorAgent({
    ferramentasDeDelegacao: [delegarRedator],
    agentRuntime
  });

  const resposta = await orquestrador.executar({
    tarefa: { id: 'task-orq', userId: 'u1' },
    mensagem: mensagemUsuario('gera o resumo da semana por assunto para enviar hoje'),
    contexto: { userId: 'u1' },
    contextId: 'ctx-orq',
    openAiConfig: CONFIG_FAKE
  });

  assert.equal(chamadasRedator.length, 1);
  assert.match(resposta.texto, /RESUMO DA SEMANA/);
});

test('Orquestrador: responde pergunta sobre o que acabou de falar diretamente pelo historico', async () => {
  // Neste caso, o orquestrador NÃO deve chamar ferramentas de delegação, respondendo diretamente.
  const { openAIGateway, toolExecutor } = montarRuntime([
    { texto: 'Você acabou de me pedir o resumo da semana por assunto para enviar hoje.' }
  ]);

  const { createAgentRuntime } = await import('../application/agents/runtime/AgentRuntime.js');
  const agentRuntime = createAgentRuntime({ openAIGateway, toolExecutor, tracer: tracerNulo });

  const orquestrador = criarOrquestradorAgent({
    ferramentasDeDelegacao: [],
    agentRuntime
  });

  // Tarefa com histórico prévio simulado
  const tarefaComHistorico = {
    id: 'task-hist-2',
    userId: 'u1',
    history: [
      {
        messageId: 'msg-1',
        role: 'user',
        parts: [{ kind: 'text', text: 'gera o resumo da semana por assunto para enviar hoje' }]
      },
      {
        messageId: 'msg-2',
        role: 'agent',
        parts: [{ kind: 'text', text: 'Aqui está o resumo da semana...' }]
      }
    ]
  };

  const resposta = await orquestrador.executar({
    tarefa: tarefaComHistorico,
    mensagem: mensagemUsuario('o que eu acabei de falar?'),
    contexto: { userId: 'u1' },
    contextId: 'ctx-hist',
    openAiConfig: CONFIG_FAKE
  });

  assert.match(resposta.texto, /resumo da semana/i);
  assert.equal(resposta.dados.ferramentasUsadas.length, 0, 'Não deve chamar ferramentas para responder sobre a própria conversa');
});
