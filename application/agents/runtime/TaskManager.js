import {
  ESTADOS_TAREFA,
  criarTarefa,
  transicionar,
  anexarMensagem,
  ehEstadoTerminal,
  gerarIdContexto
} from '../../../domain/a2a/Task.js';
import { mensagemAgente, extrairTexto, extrairDados } from '../../../domain/a2a/Message.js';
import { erroTarefaNaoEncontrada, erroTarefaNaoCancelavel } from '../../../domain/a2a/erros.js';
import { interpretarConfirmacao, RESULTADO_CONFIRMACAO } from '../../../domain/services/InterpretarConfirmacao.js';

// Orquestra o ciclo de vida das tarefas A2A e, principalmente, guarda o
// portao de escrita.
//
// O fluxo de uma escrita proposta pelo agente:
//   1. Agente chama ferramenta de escrita -> devolve PROPOSTA (nada gravado)
//   2. Tarefa vai para `input-required`, proposta fica no metadata
//   3. Usuario confirma -> executor deterministico grava e audita
//   4. Tarefa vai para `completed`
//
// O modelo participa do passo 1 e some a partir do 2. Quem grava e o
// executor registrado no wiring, com os dados exatos da proposta - nao com
// uma nova saida do LLM, que poderia divergir do que o usuario aprovou.
export function createTaskManager({
  agentRegistry,
  tarefaRepository,
  auditoriaRepository = null,
  tracer,
  executoresDeProposta = {}
}) {
  async function chamarAgente({ agente, tarefa, mensagem, openAiConfig }) {
    if (agente.transporte === 'http') {
      // Agente remoto: o transporte devolve uma Task A2A completa, ja com
      // status e historico proprios.
      return agente.cliente.enviarMensagem({
        mensagem,
        taskId: tarefa.id,
        contextId: tarefa.contextId,
        userId: tarefa.userId
      });
    }

    return agente.executar({
      tarefa,
      mensagem,
      contexto: { userId: tarefa.userId },
      contextId: tarefa.contextId,
      openAiConfig
    });
  }

  // Executa as propostas aprovadas. Deliberadamente fora do alcance do
  // modelo: itera sobre o que foi mostrado ao usuario e chama o executor
  // registrado para cada tipo.
  async function executarPropostas({ tarefa, openAiConfig }) {
    const propostas = tarefa.metadata?.propostasPendentes || [];
    const resultados = [];

    for (const proposta of propostas) {
      const executor = executoresDeProposta[proposta.tipo];

      if (!executor) {
        resultados.push({
          tipo: proposta.tipo,
          ok: false,
          erro: `Nenhum executor registrado para propostas do tipo "${proposta.tipo}".`
        });
        continue;
      }

      const span = tracer.iniciarSpan({
        contextId: tarefa.contextId,
        nome: `executar-proposta:${proposta.tipo}`,
        tipo: 'escrita',
        atributos: { impacto: proposta.impacto }
      });

      try {
        const resultado = await executor({
          dados: proposta.dados,
          userId: tarefa.userId,
          openAiConfig
        });
        span.finalizar({ status: 'ok' });
        resultados.push({ tipo: proposta.tipo, ok: true, resultado });

        if (auditoriaRepository) {
          await auditoriaRepository.registrar({
            userId: tarefa.userId,
            contextId: tarefa.contextId,
            acao: `executado:${proposta.tipo}`,
            detalhes: { proposta: proposta.dados, resultado },
            executado: true
          }).catch(e => console.log('Auditoria aviso:', e.message));
        }
      } catch (e) {
        span.finalizar({ status: 'erro', erro: e });
        resultados.push({ tipo: proposta.tipo, ok: false, erro: e.message });
      }
    }

    return resultados;
  }

  function descreverResultados(resultados) {
    const sucessos = resultados.filter(r => r.ok);
    const falhas = resultados.filter(r => !r.ok);
    const partes = [];
    if (sucessos.length) partes.push(`${sucessos.length} alteração(ões) aplicada(s) com sucesso.`);
    if (falhas.length) {
      partes.push(`${falhas.length} falharam: ${falhas.map(f => f.erro).join('; ')}`);
    }
    return partes.join(' ');
  }

  async function enviarMensagem({ agentId, mensagem, taskId = null, contextId = null, userId, openAiConfig }) {
    if (!userId) {
      // Sem identidade nao ha escopo de dados: melhor recusar do que rodar
      // um agente que enxergaria tudo.
      const erro = new Error('Identificação do usuário ausente. O agente não pode operar sem escopo.');
      erro.status = 401;
      throw erro;
    }

    const agente = agentRegistry.obter(agentId);
    let tarefa = taskId ? await tarefaRepository.obter(taskId) : null;

    if (taskId && !tarefa) throw erroTarefaNaoEncontrada(taskId);

    // Continuacao de uma tarefa que esperava confirmacao.
    if (tarefa && tarefa.status.state === ESTADOS_TAREFA.AGUARDANDO_ENTRADA) {
      // Escopo: uma tarefa so pode ser continuada por quem a criou.
      if (tarefa.userId !== userId) throw erroTarefaNaoEncontrada(taskId);

      const decisao = interpretarConfirmacao({
        texto: extrairTexto(mensagem),
        dados: extrairDados(mensagem)
      });

      tarefa = anexarMensagem(tarefa, mensagem);

      if (decisao.resultado === RESULTADO_CONFIRMACAO.NEGADO) {
        const resposta = mensagemAgente(
          'Certo, não apliquei nenhuma alteração. O que você quer fazer em vez disso?',
          { propostasDescartadas: tarefa.metadata?.propostasPendentes?.length || 0 },
          { taskId: tarefa.id, contextId: tarefa.contextId }
        );
        tarefa = transicionar(tarefa, ESTADOS_TAREFA.TRABALHANDO);
        tarefa = transicionar(tarefa, ESTADOS_TAREFA.CONCLUIDA, {
          message: resposta,
          metadata: { propostasPendentes: [] }
        });
        await tarefaRepository.salvar(tarefa);
        return tarefa;
      }

      if (decisao.resultado === RESULTADO_CONFIRMACAO.CONFIRMADO) {
        tarefa = transicionar(tarefa, ESTADOS_TAREFA.TRABALHANDO);
        const resultados = await executarPropostas({ tarefa, openAiConfig });
        const houveFalha = resultados.some(r => !r.ok);

        const resposta = mensagemAgente(
          descreverResultados(resultados),
          { resultados },
          { taskId: tarefa.id, contextId: tarefa.contextId }
        );
        tarefa = transicionar(
          tarefa,
          houveFalha && resultados.every(r => !r.ok) ? ESTADOS_TAREFA.FALHOU : ESTADOS_TAREFA.CONCLUIDA,
          { message: resposta, metadata: { propostasPendentes: [], propostasExecutadas: resultados } }
        );
        await tarefaRepository.salvar(tarefa);
        return tarefa;
      }

      // AMBIGUO: a resposta nao foi um sim nem um nao - normalmente e uma
      // instrucao nova ("sim, mas troca o projeto"). Descartamos a proposta
      // antiga e devolvemos a mensagem ao agente como pedido novo, para que
      // ele reproponha ja com a correcao. Nunca gravamos a proposta anterior.
      tarefa = transicionar(tarefa, ESTADOS_TAREFA.TRABALHANDO, {
        metadata: { propostasPendentes: [] }
      });
    } else if (tarefa) {
      if (ehEstadoTerminal(tarefa.status.state)) {
        // Tarefa encerrada nao revive: a mensagem abre uma tarefa nova no
        // MESMO contexto, preservando o fio da conversa.
        contextId = tarefa.contextId;
        tarefa = null;
        taskId = null;
      } else if (tarefa.userId !== userId) {
        throw erroTarefaNaoEncontrada(taskId);
      }
    }

    if (!tarefa) {
      const novoContextId = contextId || gerarIdContexto();
      tarefa = criarTarefa({
        contextId: novoContextId,
        agentId,
        userId,
        mensagemInicial: mensagem
      });

      // Carregar o historico de tarefas anteriores do mesmo contexto, para
      // que a conversa tenha continuidade entre turnos. Sem isso, cada
      // mensagem comeca do zero e o agente nao sabe do que o usuario falou.
      //
      // Dois filtros criticos:
      //   1. Excluir sub-tarefas de delegacao (parentTaskId != null): elas
      //      usam o MESMO contextId, mas sao falas internas entre agentes.
      //      Incluí-las faria o orquestrador ler seus proprios pedidos de
      //      delegacao como se fossem mensagens do usuario.
      //   2. Manter so roles 'user' e 'agent': mensagens de sistema ou
      //      internas nao sao parte da conversa visivel.
      if (contextId) {
        try {
          const anteriores = await tarefaRepository.listarPorContexto(contextId, userId);
          const historicoPrevio = anteriores
            // Filtrar sub-tarefas de delegacao: so tarefas de topo (sem pai)
            .filter(t => !t.metadata?.parentTaskId)
            // Excluir a tarefa recem-criada (ainda nao salva, mas por seguranca)
            .filter(t => t.id !== tarefa.id)
            .flatMap(t => t.history || [])
            // So mensagens do usuario e do agente, nao internas
            .filter(m => m.role === 'user' || m.role === 'agent');

          if (historicoPrevio.length > 0) {
            // Prepend: historico antigo vem antes da mensagem atual.
            // O corte por MAX_MENSAGENS_HISTORICO em criarAgenteLlm garante
            // que conversas longas nao estourem o contexto do modelo.
            tarefa = { ...tarefa, history: [...historicoPrevio, ...tarefa.history] };
          }
        } catch (e) {
          // Degradacao graciosa: falha ao carregar historico nao impede a
          // conversa — ela so perde a continuidade, como antes da correcao.
          console.warn('[TaskManager] Falha ao carregar histórico do contexto:', e.message);
        }
      }

      await tarefaRepository.salvar(tarefa);
      tarefa = transicionar(tarefa, ESTADOS_TAREFA.TRABALHANDO);
    } else if (tarefa.status.state === ESTADOS_TAREFA.SUBMETIDA) {
      tarefa = anexarMensagem(tarefa, mensagem);
      tarefa = transicionar(tarefa, ESTADOS_TAREFA.TRABALHANDO);
    }

    await tarefaRepository.salvar(tarefa);

    try {
      const saida = await chamarAgente({ agente, tarefa, mensagem, openAiConfig });

      // Agente remoto ja devolve uma Task pronta - respeitamos o estado dele
      // e so anexamos ao nosso registro.
      if (saida && saida.kind === 'task') {
        const espelho = { ...tarefa, status: saida.status, artifacts: saida.artifacts || tarefa.artifacts };
        await tarefaRepository.salvar(espelho);
        return espelho;
      }

      const { texto, dados = null, propostas = [], truncado = false } = saida;

      if (propostas.length > 0) {
        const resposta = mensagemAgente(
          texto || 'Preparei as alterações abaixo. Confirma?',
          { propostas, aguardandoConfirmacao: true, ...(dados || {}) },
          { taskId: tarefa.id, contextId: tarefa.contextId }
        );
        tarefa = transicionar(tarefa, ESTADOS_TAREFA.AGUARDANDO_ENTRADA, {
          message: resposta,
          metadata: { propostasPendentes: propostas }
        });
        await tarefaRepository.salvar(tarefa);
        return tarefa;
      }

      const textoFinal = truncado
        ? (texto || '') + '\n\n_Não consegui concluir o raciocínio dentro do limite de passos. O que está acima é o que apurei até aqui._'
        : texto;

      const resposta = mensagemAgente(
        textoFinal,
        dados,
        { taskId: tarefa.id, contextId: tarefa.contextId }
      );
      tarefa = transicionar(tarefa, ESTADOS_TAREFA.CONCLUIDA, { message: resposta });
      await tarefaRepository.salvar(tarefa);
      return tarefa;
    } catch (e) {
      console.error(`[TaskManager] agente ${agentId} falhou:`, e);
      const resposta = mensagemAgente(
        `Não consegui concluir: ${e.message}`,
        null,
        { taskId: tarefa.id, contextId: tarefa.contextId }
      );
      tarefa = transicionar(tarefa, ESTADOS_TAREFA.FALHOU, { message: resposta });
      await tarefaRepository.salvar(tarefa);
      return tarefa;
    }
  }

  async function obterTarefa({ taskId, userId }) {
    const tarefa = await tarefaRepository.obter(taskId);
    // Tarefa de outro usuario responde "nao encontrada", nao "sem permissao":
    // a segunda confirmaria a existencia do id para quem esta sondando.
    if (!tarefa || tarefa.userId !== userId) throw erroTarefaNaoEncontrada(taskId);
    return tarefa;
  }

  async function cancelarTarefa({ taskId, userId }) {
    const tarefa = await obterTarefa({ taskId, userId });
    if (ehEstadoTerminal(tarefa.status.state)) {
      throw erroTarefaNaoCancelavel(taskId, tarefa.status.state);
    }
    const cancelada = transicionar(tarefa, ESTADOS_TAREFA.CANCELADA, {
      message: mensagemAgente('Tarefa cancelada.', null, { taskId, contextId: tarefa.contextId }),
      metadata: { propostasPendentes: [] }
    });
    await tarefaRepository.salvar(cancelada);
    return cancelada;
  }

  return { enviarMensagem, obterTarefa, cancelarTarefa };
}
