// Tracing de spans para o sistema agentico.
//
// Num fluxo de agente unico, ler o log basta. Com orquestrador delegando a
// especialistas que chamam ferramentas que chamam o modelo, "por que ele
// respondeu isso?" vira uma pergunta sem resposta sem uma arvore de
// execucao. Este tracer existe para essa pergunta - e para as evals, que
// precisam saber quais ferramentas foram chamadas, nao so o texto final.
//
// Implementacao propositalmente pequena e sem dependencia: buffer circular
// em memoria, agrupado por `contextId` (a conversa). Nao e observabilidade
// de producao - a interface `iniciarSpan/finalizar` foi desenhada para que
// trocar por OpenTelemetry/Arize depois seja substituir este arquivo, sem
// tocar em quem chama.

const LIMITE_TRACES = 200;

function gerarId() {
  return `span_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createTracer({ limiteTraces = LIMITE_TRACES, logar = process.env.TRACE_AGENTES === 'true' } = {}) {
  // Map mantem ordem de insercao - o descarte do mais antigo e O(1) sem
  // estrutura extra.
  const traces = new Map();

  function registrarSpan(contextId, span) {
    const chave = contextId || 'sem-contexto';
    if (!traces.has(chave)) {
      traces.set(chave, []);
      if (traces.size > limiteTraces) {
        traces.delete(traces.keys().next().value);
      }
    }
    traces.get(chave).push(span);
  }

  function iniciarSpan({ contextId, nome, tipo = 'generico', parentId = null, atributos = {} }) {
    const span = {
      id: gerarId(),
      parentId,
      contextId,
      nome,
      tipo,
      atributos,
      inicio: Date.now(),
      fim: null,
      duracaoMs: null,
      status: 'em-andamento',
      erro: null
    };
    registrarSpan(contextId, span);

    return {
      id: span.id,

      // Atributos descobertos durante a execucao (ex.: quantas linhas a
      // consulta devolveu) entram depois do inicio.
      anotar(novosAtributos) {
        Object.assign(span.atributos, novosAtributos);
      },

      finalizar({ status = 'ok', erro = null, atributos = {} } = {}) {
        span.fim = Date.now();
        span.duracaoMs = span.fim - span.inicio;
        span.status = status;
        span.erro = erro ? String(erro.message || erro) : null;
        Object.assign(span.atributos, atributos);

        if (logar) {
          const marca = status === 'ok' ? '✓' : '✗';
          console.log(`[trace ${contextId}] ${marca} ${tipo}:${nome} ${span.duracaoMs}ms` + (span.erro ? ` erro=${span.erro}` : ''));
        }
      }
    };
  }

  return {
    iniciarSpan,

    obterTrace(contextId) {
      return traces.get(contextId) || [];
    },

    // Reconstroi a hierarquia para leitura humana (o array cru e plano).
    obterArvore(contextId) {
      const spans = traces.get(contextId) || [];
      const porId = new Map(spans.map(s => [s.id, { ...s, filhos: [] }]));
      const raizes = [];
      for (const span of porId.values()) {
        const pai = span.parentId ? porId.get(span.parentId) : null;
        if (pai) pai.filhos.push(span);
        else raizes.push(span);
      }
      return raizes;
    },

    limpar() {
      traces.clear();
    }
  };
}

// Tracer nulo: usado quando um componente e instanciado fora do wiring
// principal (testes unitarios, scripts) e nao ha por que coletar nada.
export const tracerNulo = {
  iniciarSpan: () => ({ id: 'nulo', anotar: () => {}, finalizar: () => {} }),
  obterTrace: () => [],
  obterArvore: () => [],
  limpar: () => {}
};
