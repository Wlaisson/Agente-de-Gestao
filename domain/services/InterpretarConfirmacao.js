// Decide se a resposta do usuario a uma proposta de escrita e um "sim".
//
// Esta funcao e o ultimo portao antes de qualquer gravacao feita por
// iniciativa do agente, e por isso e deliberadamente BURRA. Nao usa modelo:
// pedir ao LLM que classifique "isso foi uma confirmacao?" coloca a decisao
// de gravar no mesmo componente que pode ser manipulado por injecao de
// prompt, e torna nao-deterministico o passo que mais precisa ser previsivel.
//
// Regras:
// - O caminho normal e estruturado: a UI manda { confirmar: true } ao clicar
//   no botao. Texto livre e a excecao, nao a regra.
// - Texto livre so confirma com afirmacao curta e inequivoca. Frase longa
//   ("sim, mas antes muda o projeto pra X") NAO confirma: e uma instrucao
//   nova, e tratar como "sim" gravaria algo diferente do que foi pedido.
// - Negacao tem precedencia sobre afirmacao no mesmo texto.

const AFIRMACOES = new Set([
  'sim', 's', 'ok', 'okay', 'claro', 'confirmo', 'confirmado', 'confirma',
  'pode', 'podeser', 'podecriar', 'podesalvar', 'podefazer', 'podemandar',
  'isso', 'issomesmo', 'exato', 'exatamente', 'perfeito', 'certo', 'correto',
  'aprovado', 'aprovo', 'manda', 'mandaver', 'vai', 'bora', 'fecha', 'fechado',
  'positivo', 'salva', 'salvar', 'cria', 'criar', 'registra', 'registrar', 'tabom'
]);

const NEGACOES = new Set([
  'nao', 'n', 'negativo', 'cancela', 'cancelar', 'cancelado', 'pare', 'parar',
  'espera', 'deixa', 'esquece', 'errado', 'incorreto', 'nada',
  'aindanao', 'agoranao', 'melhornao'
]);
// "para" fica DE FORA de proposito, embora seja imperativo de "parar": e
// preposicao comum em portugues, e "pode criar para o projeto X" seria lido
// como recusa. A forma imperativa aparece quase sempre como "pare"/"parar".

// Limite de palavras para texto livre contar como confirmacao pura. Acima
// disso ha instrucao junto, e instrucao precisa de nova rodada do agente.
const MAX_PALAVRAS_CONFIRMACAO = 4;

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export const RESULTADO_CONFIRMACAO = Object.freeze({
  CONFIRMADO: 'confirmado',
  NEGADO: 'negado',
  AMBIGUO: 'ambiguo'
});

export function interpretarConfirmacao({ texto = '', dados = null } = {}) {
  // 1. Caminho estruturado (botao da UI). Explicito e sem interpretacao.
  if (dados && typeof dados === 'object') {
    if (dados.confirmar === true) {
      return { resultado: RESULTADO_CONFIRMACAO.CONFIRMADO, origem: 'estruturado' };
    }
    if (dados.confirmar === false) {
      return { resultado: RESULTADO_CONFIRMACAO.NEGADO, origem: 'estruturado' };
    }
  }

  // 2. Texto livre.
  const normalizado = normalizar(texto);
  if (!normalizado) return { resultado: RESULTADO_CONFIRMACAO.AMBIGUO, origem: 'vazio' };

  const palavras = normalizado.split(' ');
  const colado = palavras.join('');

  const temNegacao = palavras.some(p => NEGACOES.has(p)) || NEGACOES.has(colado);
  if (temNegacao) {
    return { resultado: RESULTADO_CONFIRMACAO.NEGADO, origem: 'texto' };
  }

  if (palavras.length > MAX_PALAVRAS_CONFIRMACAO) {
    // Ex.: "sim, mas antes troca o projeto para RedePRO" - tem "sim", mas
    // confirmar aqui gravaria a proposta ANTIGA, ignorando a correcao.
    return { resultado: RESULTADO_CONFIRMACAO.AMBIGUO, origem: 'texto-longo' };
  }

  const temAfirmacao = palavras.some(p => AFIRMACOES.has(p)) || AFIRMACOES.has(colado);
  if (temAfirmacao) {
    return { resultado: RESULTADO_CONFIRMACAO.CONFIRMADO, origem: 'texto' };
  }

  return { resultado: RESULTADO_CONFIRMACAO.AMBIGUO, origem: 'texto' };
}
