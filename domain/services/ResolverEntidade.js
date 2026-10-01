// Resolucao de nomes falados para os valores canonicos cadastrados.
//
// O usuario fala "rede pro", "redepro", "Rede PRO"; o banco tem "RedePRO".
// Sem esta camada o agente faria `where projeto = 'rede pro'`, acharia zero
// linhas e responderia "voce nao trabalhou nisso" - que e pior do que errar
// em voz alta, porque parece uma resposta legitima.
//
// Decisao deliberada: casamento por heuristica local, sem dependencia nova
// no package.json. O universo e pequeno (dezenas de projetos/assuntos por
// usuario, vindos de `opcoes`), entao um scan linear com pontuacao resolve
// melhor - e de forma auditavel - do que embeddings ou uma lib de fuzzy.
//
// Ambiguidade NAO e resolvida por chute: quando dois candidatos empatam
// perto do topo, devolvemos `ambiguo` com as opcoes, e o agente pergunta.

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');      // "Rede PRO" e "redepro" colapsam no mesmo
}

function tokens(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Distancia de edicao com duas linhas em vez da matriz inteira: as strings
// aqui sao nomes curtos, mas a funcao roda para cada candidato a cada
// pergunta do usuario.
function distanciaEdicao(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  let atual = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    atual[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo);
    }
    [anterior, atual] = [atual, anterior];
  }
  return anterior[b.length];
}

// Pontuacao 0..1. As faixas sao intencionalmente separadas para que um
// acerto exato nunca perca para um "contem" longo.
function pontuar(consultaNorm, consultaTokens, candidato) {
  const candNorm = normalizar(candidato);
  if (!candNorm || !consultaNorm) return 0;

  if (candNorm === consultaNorm) return 1;
  if (candNorm.startsWith(consultaNorm) || consultaNorm.startsWith(candNorm)) return 0.9;
  if (candNorm.includes(consultaNorm) || consultaNorm.includes(candNorm)) return 0.8;

  // Cobertura de tokens: "tratamento aplicacoes" casa com "Tratamento de
  // Aplicacoes (20/20)" mesmo com palavras de ligacao e sufixos no meio.
  const candTokens = tokens(candidato);
  if (consultaTokens.length && candTokens.length) {
    const casados = consultaTokens.filter(t =>
      candTokens.some(ct => ct === t || ct.startsWith(t) || t.startsWith(ct))
    ).length;
    const cobertura = casados / consultaTokens.length;
    if (cobertura >= 0.6) return 0.5 + (cobertura * 0.25);
  }

  // Ultimo recurso: erro de digitacao. Tolerancia proporcional ao tamanho,
  // limitada a 3 para nao casar palavras curtas sem relacao.
  const distancia = distanciaEdicao(consultaNorm, candNorm);
  const limite = Math.min(3, Math.floor(Math.max(consultaNorm.length, candNorm.length) * 0.3));
  if (distancia <= limite && limite > 0) {
    return 0.45 * (1 - distancia / (limite + 1));
  }

  return 0;
}

export const LIMIAR_ACEITACAO = 0.45;
// Se o segundo colocado esta a menos disto do primeiro, e ambiguidade real -
// perguntar custa uma mensagem; responder sobre o projeto errado custa a
// confianca no numero.
export const MARGEM_AMBIGUIDADE = 0.12;

export function resolverEntidade(consulta, candidatos, { limiar = LIMIAR_ACEITACAO } = {}) {
  const lista = (Array.isArray(candidatos) ? candidatos : []).filter(c => c !== null && c !== undefined && c !== '');
  const consultaNorm = normalizar(consulta);

  if (!consultaNorm) return { encontrado: false, motivo: 'consulta_vazia', valor: null, alternativas: [] };
  if (lista.length === 0) return { encontrado: false, motivo: 'sem_candidatos', valor: null, alternativas: [] };

  const consultaTokens = tokens(consulta);
  const pontuados = lista
    .map(c => ({ valor: c, pontuacao: pontuar(consultaNorm, consultaTokens, c) }))
    .filter(p => p.pontuacao > 0)
    .sort((a, b) => b.pontuacao - a.pontuacao);

  if (pontuados.length === 0 || pontuados[0].pontuacao < limiar) {
    return {
      encontrado: false,
      motivo: 'sem_correspondencia',
      valor: null,
      // Devolver o universo deixa o agente oferecer as opcoes reais em vez
      // de pedir ao usuario que "digite o nome exato".
      alternativas: lista.slice(0, 10)
    };
  }

  const empatados = pontuados.filter(p => pontuados[0].pontuacao - p.pontuacao <= MARGEM_AMBIGUIDADE);
  if (empatados.length > 1 && pontuados[0].pontuacao < 1) {
    return {
      encontrado: false,
      motivo: 'ambiguo',
      valor: null,
      alternativas: empatados.map(p => p.valor)
    };
  }

  return {
    encontrado: true,
    motivo: 'ok',
    valor: pontuados[0].valor,
    pontuacao: pontuados[0].pontuacao,
    alternativas: pontuados.slice(1, 4).map(p => p.valor)
  };
}
