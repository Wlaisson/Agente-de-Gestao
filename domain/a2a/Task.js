// Ciclo de vida de uma tarefa A2A (Agent-to-Agent).
//
// Os estados seguem a especificacao do A2A em vez de um enum caseiro porque
// o objetivo declarado e poder expor estes agentes para OUTROS sistemas
// agenticos (o "Core agentico" da CWS, agentes de Catalogo/Especificacoes)
// sem renegociar contrato. Um estado fora da spec vira trabalho de traducao
// na fronteira depois.
//
// O estado que mais importa aqui e `input-required`: e ele que sustenta a
// regra de seguranca do sistema - nenhuma escrita (criar atividade, mover
// card) acontece sem confirmacao humana. O agente para em `input-required`
// carregando a proposta, e so a confirmacao explicita do usuario retoma.
export const ESTADOS_TAREFA = Object.freeze({
  SUBMETIDA: 'submitted',
  TRABALHANDO: 'working',
  AGUARDANDO_ENTRADA: 'input-required',
  CONCLUIDA: 'completed',
  CANCELADA: 'canceled',
  FALHOU: 'failed',
  REJEITADA: 'rejected'
});

// Estados terminais: uma tarefa que chegou aqui nao volta atras. Qualquer
// tentativa de transicao a partir deles e bug de chamador, nao fluxo normal.
const TERMINAIS = new Set([
  ESTADOS_TAREFA.CONCLUIDA,
  ESTADOS_TAREFA.CANCELADA,
  ESTADOS_TAREFA.FALHOU,
  ESTADOS_TAREFA.REJEITADA
]);

const TRANSICOES_VALIDAS = Object.freeze({
  [ESTADOS_TAREFA.SUBMETIDA]: [
    ESTADOS_TAREFA.TRABALHANDO,
    ESTADOS_TAREFA.CANCELADA,
    ESTADOS_TAREFA.FALHOU,
    ESTADOS_TAREFA.REJEITADA
  ],
  [ESTADOS_TAREFA.TRABALHANDO]: [
    ESTADOS_TAREFA.AGUARDANDO_ENTRADA,
    ESTADOS_TAREFA.CONCLUIDA,
    ESTADOS_TAREFA.CANCELADA,
    ESTADOS_TAREFA.FALHOU,
    ESTADOS_TAREFA.REJEITADA
  ],
  // De `input-required` so se volta a trabalhar (usuario confirmou/respondeu)
  // ou se cancela (usuario desistiu). Nao se pula direto para `completed`:
  // a resposta do usuario sempre passa por uma rodada de execucao.
  [ESTADOS_TAREFA.AGUARDANDO_ENTRADA]: [
    ESTADOS_TAREFA.TRABALHANDO,
    ESTADOS_TAREFA.CANCELADA,
    ESTADOS_TAREFA.FALHOU
  ]
});

export function ehEstadoTerminal(estado) {
  return TERMINAIS.has(estado);
}

export function podeTransicionar(de, para) {
  if (de === para) return false;
  return (TRANSICOES_VALIDAS[de] || []).includes(para);
}

export function gerarIdTarefa() {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function gerarIdContexto() {
  return `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// `contextId` agrupa varias tarefas de uma mesma conversa - e o que permite
// o orquestrador delegar 3 vezes ao mesmo especialista e ainda assim tudo
// ser rastreavel como um dialogo so no tracing e na auditoria.
export function criarTarefa({
  id = gerarIdTarefa(),
  contextId = gerarIdContexto(),
  agentId,
  userId,
  mensagemInicial = null,
  metadata = {}
} = {}) {
  const agora = new Date().toISOString();
  return {
    id,
    contextId,
    agentId,
    // userId NUNCA vem do modelo - e injetado pelo servidor a partir do
    // token autenticado. Ver ToolExecutor.
    userId,
    status: {
      state: ESTADOS_TAREFA.SUBMETIDA,
      timestamp: agora,
      message: null
    },
    history: mensagemInicial ? [mensagemInicial] : [],
    artifacts: [],
    metadata,
    criadoEm: agora,
    atualizadoEm: agora
  };
}

// Transicao imutavel: devolve uma tarefa nova em vez de mutar a recebida.
// Facilita o repositorio decidir o que persistir e evita que um agente
// intermediario corrompa o estado visto por outro.
export function transicionar(tarefa, novoEstado, { message = null, metadata } = {}) {
  if (!podeTransicionar(tarefa.status.state, novoEstado)) {
    const erro = new Error(
      `Transicao invalida de "${tarefa.status.state}" para "${novoEstado}" na tarefa ${tarefa.id}.`
    );
    erro.code = 'TRANSICAO_INVALIDA';
    throw erro;
  }

  const agora = new Date().toISOString();
  return {
    ...tarefa,
    status: { state: novoEstado, timestamp: agora, message },
    history: message ? [...tarefa.history, message] : tarefa.history,
    metadata: metadata ? { ...tarefa.metadata, ...metadata } : tarefa.metadata,
    atualizadoEm: agora
  };
}

export function anexarMensagem(tarefa, mensagem) {
  return {
    ...tarefa,
    history: [...tarefa.history, mensagem],
    atualizadoEm: new Date().toISOString()
  };
}

export function anexarArtefato(tarefa, artefato) {
  return {
    ...tarefa,
    artifacts: [...tarefa.artifacts, artefato],
    atualizadoEm: new Date().toISOString()
  };
}
