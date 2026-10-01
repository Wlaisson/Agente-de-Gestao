import { erroAgenteNaoEncontrado } from '../../../domain/a2a/erros.js';

// Registro e descoberta de agentes.
//
// E o que faz este sistema ser distribuido em vez de so modular: o
// orquestrador nunca importa um especialista. Ele consulta o registry, le os
// agent cards e monta as ferramentas de delegacao a partir deles. Um agente
// local e um agente remoto (outro servico, outro time, o Core agentico da
// CWS) entram pela MESMA porta - muda o transporte, nao o chamador.
//
// Consequencia pratica: mover o `redator` para um deploy proprio e trocar a
// linha de registro de `registrarLocal` para `registrarRemoto`. Nenhum outro
// arquivo muda.
export function createAgentRegistry() {
  const agentes = new Map();

  function registrarLocal({ card, executar }) {
    if (!card?.id) throw new Error('registrarLocal exige um agent card com "id".');
    if (typeof executar !== 'function') throw new Error(`Agente "${card.id}" exige "executar".`);
    agentes.set(card.id, { card, executar, transporte: 'local' });
    return card.id;
  }

  // `cliente` implementa a mesma interface do transporte local
  // (enviarMensagem/obterTarefa/cancelarTarefa) falando JSON-RPC por HTTP.
  function registrarRemoto({ card, cliente }) {
    if (!card?.id) throw new Error('registrarRemoto exige um agent card com "id".');
    if (!cliente?.enviarMensagem) throw new Error(`Agente remoto "${card.id}" exige cliente com "enviarMensagem".`);
    agentes.set(card.id, { card, cliente, transporte: 'http' });
    return card.id;
  }

  function obter(agentId) {
    const agente = agentes.get(agentId);
    if (!agente) throw erroAgenteNaoEncontrado(agentId);
    return agente;
  }

  return {
    registrarLocal,
    registrarRemoto,
    obter,

    existe: (agentId) => agentes.has(agentId),

    listarCards: () => [...agentes.values()].map(a => a.card),

    // O orquestrador se exclui da propria lista de delegacao - delegar para
    // si mesmo e recursao infinita com custo de token.
    listarDelegaveis: (excluirId) =>
      [...agentes.values()].filter(a => a.card.id !== excluirId).map(a => a.card)
  };
}
