import { ErroA2A, CODIGOS_JSONRPC, erroMetodoNaoEncontrado, erroParametrosInvalidos } from '../../domain/a2a/erros.js';
import { criarMensagem, PAPEIS } from '../../domain/a2a/Message.js';

// Servidor JSON-RPC 2.0 que implementa os metodos A2A.
//
// E esta camada que torna os agentes consumiveis por QUALQUER cliente A2A -
// inclusive de outro time, em outra linguagem. A UI deste projeto usa um
// endpoint REST mais simples por cima do mesmo TaskManager; este aqui existe
// para a fronteira externa, onde o contrato precisa ser o do protocolo e nao
// o que for conveniente para o nosso front.
//
// Metodos implementados: message/send, tasks/get, tasks/cancel.
// Fora de escopo por ora: message/stream e tasks/pushNotificationConfig/* -
// os agent cards declaram `streaming: false`, entao um cliente conforme nao
// vai chama-los.

function respostaOk(id, resultado) {
  return { jsonrpc: '2.0', id: id ?? null, result: resultado };
}

function respostaErro(id, erro) {
  const corpo = erro instanceof ErroA2A
    ? erro.paraJsonRpc()
    : { code: CODIGOS_JSONRPC.INTERNAL_ERROR, message: erro?.message || 'Erro interno' };
  return { jsonrpc: '2.0', id: id ?? null, error: corpo };
}

// A Task interna carrega campos que nao pertencem ao protocolo (userId,
// criadoEm). Serializar explicitamente evita vazar estado de servidor para
// um cliente externo por descuido em alguma evolucao futura.
function tarefaParaA2A(tarefa) {
  return {
    kind: 'task',
    id: tarefa.id,
    contextId: tarefa.contextId,
    status: tarefa.status,
    history: tarefa.history,
    artifacts: tarefa.artifacts,
    metadata: {
      agentId: tarefa.agentId,
      // Propostas pendentes fazem parte do contrato: sao o que o cliente
      // precisa renderizar para o usuario confirmar.
      propostasPendentes: tarefa.metadata?.propostasPendentes || []
    }
  };
}

export function createA2AJsonRpcServer({ taskManager, agentRegistry, resolverOpenAiConfig }) {
  async function messageSend(params, contexto) {
    const { message, agentId = 'orquestrador', configuration = {} } = params || {};
    if (!message || !Array.isArray(message.parts)) {
      throw erroParametrosInvalidos('O parâmetro "message" com "parts" é obrigatório.');
    }
    if (!agentRegistry.existe(agentId)) {
      throw erroParametrosInvalidos(`Agente desconhecido: "${agentId}".`);
    }

    const mensagem = criarMensagem({
      role: message.role || PAPEIS.USUARIO,
      parts: message.parts,
      taskId: message.taskId || null,
      contextId: message.contextId || configuration.contextId || null
    });

    const openAiConfig = await resolverOpenAiConfig(contexto.userId);

    const tarefa = await taskManager.enviarMensagem({
      agentId,
      mensagem,
      taskId: message.taskId || null,
      contextId: mensagem.contextId,
      userId: contexto.userId,
      openAiConfig
    });

    return tarefaParaA2A(tarefa);
  }

  async function tasksGet(params, contexto) {
    const { id } = params || {};
    if (!id) throw erroParametrosInvalidos('O parâmetro "id" é obrigatório.');
    const tarefa = await taskManager.obterTarefa({ taskId: id, userId: contexto.userId });
    return tarefaParaA2A(tarefa);
  }

  async function tasksCancel(params, contexto) {
    const { id } = params || {};
    if (!id) throw erroParametrosInvalidos('O parâmetro "id" é obrigatório.');
    const tarefa = await taskManager.cancelarTarefa({ taskId: id, userId: contexto.userId });
    return tarefaParaA2A(tarefa);
  }

  const METODOS = {
    'message/send': messageSend,
    'tasks/get': tasksGet,
    'tasks/cancel': tasksCancel
  };

  async function processar(corpo, contexto) {
    if (!corpo || corpo.jsonrpc !== '2.0' || typeof corpo.method !== 'string') {
      return respostaErro(corpo?.id, new ErroA2A(
        CODIGOS_JSONRPC.INVALID_REQUEST,
        'Requisição JSON-RPC inválida: exige jsonrpc "2.0" e "method".'
      ));
    }

    const metodo = METODOS[corpo.method];
    if (!metodo) return respostaErro(corpo.id, erroMetodoNaoEncontrado(corpo.method));

    try {
      return respostaOk(corpo.id, await metodo(corpo.params, contexto));
    } catch (e) {
      if (!(e instanceof ErroA2A)) console.error('[a2a/jsonrpc]', e);
      return respostaErro(corpo.id, e);
    }
  }

  return { processar, tarefaParaA2A };
}
