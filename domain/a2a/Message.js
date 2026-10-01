// Mensagens e artefatos A2A.
//
// Uma mensagem A2A nao e uma string: e uma lista de "parts" tipadas. Isso
// existe para o caso que aparece o tempo todo neste produto - a resposta do
// agente traz AO MESMO TEMPO um texto para o humano ler e um dado estruturado
// para a UI (ou outro agente) consumir sem reparsear portugues.
//
// Exemplo real: "Voce gastou 12h30 na RedePRO esta semana" (TextPart) +
// { totalSegundos: 45000, atividades: [...] } (DataPart). O front usa o
// DataPart para montar a tabela; o humano le o TextPart.

export const PAPEIS = Object.freeze({
  USUARIO: 'user',
  AGENTE: 'agent'
});

export function parteTexto(texto) {
  return { kind: 'text', text: String(texto ?? '') };
}

export function parteDados(dados) {
  return { kind: 'data', data: dados ?? {} };
}

export function gerarIdMensagem() {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function criarMensagem({ role, parts, taskId = null, contextId = null, metadata = {} }) {
  return {
    kind: 'message',
    messageId: gerarIdMensagem(),
    role,
    parts: Array.isArray(parts) ? parts : [parts],
    taskId,
    contextId,
    metadata
  };
}

export function mensagemUsuario(texto, extras = {}) {
  return criarMensagem({ role: PAPEIS.USUARIO, parts: [parteTexto(texto)], ...extras });
}

export function mensagemAgente(texto, dados = null, extras = {}) {
  const parts = [parteTexto(texto)];
  if (dados !== null && dados !== undefined) parts.push(parteDados(dados));
  return criarMensagem({ role: PAPEIS.AGENTE, parts, ...extras });
}

// Concatena so as partes de texto - usado quando um agente precisa entregar
// a saida de outro agente para o modelo como contexto textual.
export function extrairTexto(mensagem) {
  if (!mensagem || !Array.isArray(mensagem.parts)) return '';
  return mensagem.parts
    .filter(p => p.kind === 'text')
    .map(p => p.text)
    .join('\n')
    .trim();
}

// Funde todas as partes de dados num objeto so. Mensagens normalmente tem
// no maximo uma DataPart; o merge cobre o caso de um agente compor a
// resposta a partir de varias fontes.
export function extrairDados(mensagem) {
  if (!mensagem || !Array.isArray(mensagem.parts)) return null;
  const partes = mensagem.parts.filter(p => p.kind === 'data');
  if (partes.length === 0) return null;
  return partes.reduce((acc, p) => ({ ...acc, ...p.data }), {});
}

export function criarArtefato({ name, description = '', parts, metadata = {} }) {
  return {
    artifactId: `art_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    name,
    description,
    parts: Array.isArray(parts) ? parts : [parts],
    metadata
  };
}
