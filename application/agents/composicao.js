import { createTracer } from '../../infrastructure/tracing/Tracer.js';
import { createAgentRegistry } from './registry/AgentRegistry.js';
import { createToolExecutor } from './runtime/ToolExecutor.js';
import { createAgentRuntime } from './runtime/AgentRuntime.js';
import { createTaskManager } from './runtime/TaskManager.js';
import { criarFerramentasDeDelegacao } from './orchestrator/criarDelegacao.js';
import { criarAtividadesTools } from './tools/atividadesTools.js';
import { criarKanbanTools } from './tools/kanbanTools.js';
import { criarRegistroTools } from './tools/registroTools.js';
import { criarAnalistaAgent } from './analista/AnalistaAgent.js';
import { criarRedatorAgent } from './redator/RedatorAgent.js';
import { criarPlanejadorAgent } from './planejador/PlanejadorAgent.js';
import { criarRegistroAgent } from './registro/RegistroAgent.js';
import { criarOrquestradorAgent } from './orchestrator/OrchestratorAgent.js';
import { createHttpA2AClient } from '../../interface-adapters/a2a/HttpA2AClient.js';

// Composition root do sistema multiagente.
//
// Recebe os use-cases que o app ja tem e monta os agentes em cima deles -
// nenhuma regra de negocio e reimplementada aqui. Um agente que lista
// atividades chama o MESMO `listarAtividades` que a tela usa; corrigir um
// bug de dominio conserta os dois caminhos de uma vez.
//
// Ordem de montagem (importa): ferramentas -> especialistas -> registry ->
// delegacao -> orquestrador. O orquestrador so pode ser montado depois que
// os cards dos especialistas estao publicados, porque as ferramentas de
// delegacao dele sao DERIVADAS desses cards.

// Agentes remotos declarados por ambiente, no formato:
//   AGENTES_REMOTOS=redator@https://redator.exemplo.com,catalogo@https://core.cws/agents
// Vazio (o padrao) = todos os agentes rodam em processo. E assim que um
// especialista vira servico independente sem tocar em codigo.
function parsearAgentesRemotos(valor) {
  if (!valor) return [];
  return valor.split(',').map(entrada => {
    const [agentId, ...resto] = entrada.trim().split('@');
    const baseUrl = resto.join('@');
    if (!agentId || !baseUrl) return null;
    return { agentId: agentId.trim(), baseUrl: baseUrl.trim() };
  }).filter(Boolean);
}

export function comporSistemaDeAgentes({
  // Use-cases existentes do app.
  listarAtividades,
  criarAtividade,
  listarCards,
  adicionarCard,
  atualizarStatusCard,
  obterOpcoes,
  obterConfigUsuario,
  // Infra.
  atividadeRepository,
  tarefaRepository,
  auditoriaRepository,
  openAIGateway,
  embeddingsGateway,
  agentesRemotos = parsearAgentesRemotos(process.env.AGENTES_REMOTOS)
}) {
  const tracer = createTracer();
  const agentRegistry = createAgentRegistry();
  const toolExecutor = createToolExecutor({ tracer, auditoriaRepository });
  const agentRuntime = createAgentRuntime({ openAIGateway, toolExecutor, tracer });

  // --- Ferramentas -------------------------------------------------------
  const atividadesTools = criarAtividadesTools({
    listarAtividades,
    obterOpcoes,
    atividadeRepository,
    openAIGateway,
    embeddingsGateway
  });
  const kanbanTools = criarKanbanTools({ listarCards, obterOpcoes });
  const registroTools = criarRegistroTools({ obterOpcoes });

  const listarTarefasTool = kanbanTools.find(f => f.nome === 'listar_tarefas');
  if (!listarTarefasTool) {
    throw new Error('Ferramenta "listar_tarefas" não encontrada em kanbanTools.');
  }

  // --- Especialistas -----------------------------------------------------
  const especialistas = [
    criarAnalistaAgent({ ferramentas: atividadesTools, agentRuntime }),
    criarRedatorAgent({
      // O redator precisa das tarefas para a secao "Proximas etapas" do
      // Weekly, alem das atividades para o corpo do slide.
      ferramentas: [...atividadesTools, listarTarefasTool],
      agentRuntime,
      obterPerfilUsuario: obterConfigUsuario
    }),
    criarPlanejadorAgent({ ferramentas: kanbanTools, agentRuntime }),
    criarRegistroAgent({ ferramentas: registroTools, agentRuntime })
  ];

  const remotos = new Set(agentesRemotos.map(r => r.agentId));
  for (const especialista of especialistas) {
    // Um agente declarado como remoto nao e registrado localmente, mesmo
    // que o codigo dele exista neste bundle - senao teriamos duas versoes
    // do mesmo agente respondendo pelo mesmo id.
    if (!remotos.has(especialista.card.id)) {
      agentRegistry.registrarLocal(especialista);
    }
  }

  for (const { agentId, baseUrl } of agentesRemotos) {
    const local = especialistas.find(e => e.card.id === agentId);
    // Usa o card local como descricao quando existir (evita uma ida a rede
    // no boot); caso contrario, o card precisa ser buscado do servico - o
    // que fica a cargo de quem registra um agente de terceiro.
    if (!local) {
      console.warn(`[a2a] Agente remoto "${agentId}" sem card local. Registre-o explicitamente com o card publicado pelo serviço.`);
      continue;
    }
    agentRegistry.registrarRemoto({
      card: { ...local.card, url: baseUrl },
      cliente: createHttpA2AClient({ baseUrl, agentId })
    });
  }

  // --- Orquestrador ------------------------------------------------------
  const ferramentasDeDelegacao = criarFerramentasDeDelegacao({
    agentRegistry,
    orquestradorId: 'orquestrador',
    tarefaRepository,
    tracer
  });
  agentRegistry.registrarLocal(criarOrquestradorAgent({ ferramentasDeDelegacao, agentRuntime }));

  // --- Executores de proposta -------------------------------------------
  // O unico lugar do sistema onde uma escrita solicitada pelo agente
  // acontece de fato. Cada executor recebe os dados EXATOS da proposta que
  // o usuario aprovou - nao uma nova saida do modelo, que poderia divergir
  // do que foi mostrado na tela.
  const executoresDeProposta = {
    registrar_atividade: async ({ dados, userId }) => {
      const registro = await criarAtividade({
        userId,
        body: {
          titulo: dados.titulo,
          atividade: dados.atividade,
          data: dados.data,
          semana: dados.semana,
          projeto: dados.projeto,
          assuntoInterno: dados.assuntoInterno,
          tempo: dados.tempo
        }
      });
      return { id: registro.id, titulo: registro.titulo, data: registro.data };
    },

    criar_tarefa: async ({ dados, userId }) => {
      const card = await adicionarCard({
        titulo: dados.titulo,
        descricao: dados.descricao,
        projeto: dados.projeto,
        assuntoInterno: dados.assuntoInterno,
        prioridade: dados.prioridade,
        prazo: dados.prazo,
        status: dados.status
      }, userId);
      return { id: card.id, titulo: card.titulo };
    },

    mover_tarefa: async ({ dados, userId }) => {
      await atualizarStatusCard({ id: dados.id, status: dados.novoStatus, userId });
      return { id: dados.id, titulo: dados.titulo, status: dados.novoStatus };
    }
  };

  const taskManager = createTaskManager({
    agentRegistry,
    tarefaRepository,
    auditoriaRepository,
    tracer,
    executoresDeProposta
  });

  return { tracer, agentRegistry, taskManager, agentRuntime };
}
