// Cliente A2A sobre HTTP: fala com um agente que roda em OUTRO processo ou
// em outro serviço.
//
// Implementa a mesma interface que o registry espera de um agente local
// (`enviarMensagem`/`obterTarefa`/`cancelarTarefa`), e e por isso que
// promover um especialista a servico independente nao toca o orquestrador:
// muda so a linha de registro no wiring.
//
// Este arquivo tambem e o que permitiria plugar um agente de OUTRO time
// (o Core agentico da CWS, um agente de Catalogo) sem adaptacao, desde que
// ele fale A2A.

import { erroAgenteNaoEncontrado, ErroA2A, CODIGOS_JSONRPC } from '../../domain/a2a/erros.js';

const TIMEOUT_PADRAO_MS = 60000;

export function createHttpA2AClient({
  baseUrl,
  agentId,
  // Segredo compartilhado entre servicos. A identidade do usuario viaja no
  // corpo (userId), entao o canal precisa ser autenticado - senao qualquer
  // um que alcance a URL consulta dados de qualquer usuario.
  tokenServico = process.env.A2A_TOKEN_SERVICO || null,
  timeoutMs = TIMEOUT_PADRAO_MS,
  fetchImpl = fetch
}) {
  if (!baseUrl) throw new Error('createHttpA2AClient exige "baseUrl".');

  let contadorId = 0;

  async function chamar(metodo, params) {
    const controller = new AbortController();
    // Sem timeout, um agente remoto pendurado prende a requisicao do usuario
    // ate o limite da plataforma.
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resposta = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/a2a`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tokenServico ? { 'x-a2a-service-token': tokenServico } : {})
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++contadorId, method: metodo, params }),
        signal: controller.signal
      });

      if (!resposta.ok) {
        throw new ErroA2A(
          CODIGOS_JSONRPC.INTERNAL_ERROR,
          `Agente remoto "${agentId}" respondeu HTTP ${resposta.status}.`
        );
      }

      const corpo = await resposta.json();
      if (corpo.error) {
        throw new ErroA2A(corpo.error.code, corpo.error.message, corpo.error.data);
      }
      return corpo.result;
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new ErroA2A(
          CODIGOS_JSONRPC.INTERNAL_ERROR,
          `Agente remoto "${agentId}" não respondeu em ${timeoutMs}ms.`
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async enviarMensagem({ mensagem, taskId, contextId, userId }) {
      return chamar('message/send', {
        agentId,
        message: {
          role: mensagem.role,
          parts: mensagem.parts,
          taskId: taskId || null,
          contextId: contextId || null
        },
        // Identidade propagada explicitamente: o servico remoto aplica o
        // mesmo escopo por usuario que aplicariamos aqui.
        configuration: { userId }
      });
    },

    obterTarefa({ taskId }) {
      return chamar('tasks/get', { id: taskId });
    },

    cancelarTarefa({ taskId }) {
      return chamar('tasks/cancel', { id: taskId });
    },

    // Descoberta: le o agent card publicado pelo servico remoto. Usado no
    // wiring para registrar um agente externo sem hard-code do card.
    async obterCard() {
      const resposta = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/.well-known/agent-card.json`);
      if (!resposta.ok) throw erroAgenteNaoEncontrado(agentId);
      return resposta.json();
    }
  };
}
