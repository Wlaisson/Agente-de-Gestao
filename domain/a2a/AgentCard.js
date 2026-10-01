// Agent Card: o documento de auto-descricao que um agente A2A publica em
// /.well-known/agent-card.json.
//
// E o que torna o sistema "distribuido" de verdade em vez de so modular: o
// orquestrador nao tem os especialistas hard-coded, ele LE os cards do
// registry e monta as ferramentas de delegacao a partir deles. Plugar um
// agente novo (ou um agente externo da CWS, via HTTP) e questao de registrar
// o card - nenhuma linha do orquestrador muda.
//
// Por isso `skills` importa: cada skill vira uma ferramenta de delegacao no
// orquestrador, com a `description` do card servindo de criterio de
// roteamento para o modelo.

export function criarAgentCard({
  id,
  name,
  description,
  version = '1.0.0',
  url = null,
  skills = [],
  // `escrita` sinaliza que o agente pode PROPOR mudancas de dados. Nenhum
  // agente escreve direto (ver ToolExecutor/propostas), mas o orquestrador
  // usa esta flag para exigir confirmacao antes de dar a tarefa por concluida.
  capabilities = { streaming: false, pushNotifications: false, escrita: false },
  defaultInputModes = ['text/plain'],
  defaultOutputModes = ['text/plain', 'application/json']
}) {
  if (!id) throw new Error('Agent card exige "id".');
  if (!name) throw new Error('Agent card exige "name".');
  if (!description) throw new Error('Agent card exige "description".');

  return {
    protocolVersion: '0.3.0',
    id,
    name,
    description,
    version,
    url,
    capabilities,
    defaultInputModes,
    defaultOutputModes,
    skills: skills.map(normalizarSkill)
  };
}

function normalizarSkill(skill) {
  if (!skill || !skill.id) throw new Error('Skill de agent card exige "id".');
  return {
    id: skill.id,
    name: skill.name || skill.id,
    description: skill.description || '',
    tags: skill.tags || [],
    // Exemplos entram no prompt do orquestrador como sinal de roteamento.
    // Sao frases que um usuario diria, nao chamadas de API.
    examples: skill.examples || []
  };
}

// Serializa o card para exposicao HTTP. Hoje e identidade, mas centraliza o
// ponto onde campos internos seriam removidos caso o card passe a carregar
// algo que nao deve vazar para fora.
export function cardParaJson(card) {
  return { ...card };
}
