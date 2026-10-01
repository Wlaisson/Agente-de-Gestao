import { definirFerramenta, resultadoOk, resultadoErro } from '../runtime/definirFerramenta.js';
import { resolverPeriodo } from '../../../domain/services/ResolverPeriodo.js';
import { resolverEntidade } from '../../../domain/services/ResolverEntidade.js';
import { somarTempoAtividades, segundosParaTextoHumano } from '../../../domain/services/TempoCalculator.js';
import { tentarGerarEmbedding, tentarBuscarContextoRag } from '../../../shared/embeddingHelpers.js';

// Ferramentas de leitura sobre atividades.
//
// Padrao aplicado em todas: o modelo escolhe O QUE consultar (periodo,
// projeto), o codigo executa e CALCULA. Nenhum total desta resposta passa
// pela aritmetica do LLM - `somarTempoAtividades` e a unica fonte de numero.
//
// O filtro por nome tambem e feito aqui, em memoria, e nao no SQL: o usuario
// fala "rede pro" e o banco guarda "Projetos - Rede Pró". Resolver contra os
// valores REALMENTE presentes no periodo (nao so contra a lista de opcoes)
// evita responder "nao encontrei" para um projeto que existe nas atividades
// mas nunca foi cadastrado em `opcoes`.

const PARAMETRO_PERIODO = {
  type: 'string',
  description:
    'Período em linguagem natural, REPASSADO COMO O USUÁRIO FALOU: "esta semana", ' +
    '"semana passada", "hoje", "ontem", "este mês", "mês passado", "últimos 30 dias", ' +
    'um mês nomeado ("setembro"), um intervalo ISO (AAAA-MM-DD a AAAA-MM-DD) ou um rótulo ' +
    'de semana (DD/MM a DD/MM). Não converta a fala do usuário em datas você mesmo — quem ' +
    'resolve é o sistema, que conhece a data de hoje. Se o usuário não disser o período, ' +
    'OMITA este parâmetro: o padrão é a semana atual.'
};

function valoresDistintos(atividades, campo) {
  return [...new Set(atividades.map(a => a[campo]).filter(Boolean))];
}

// Filtra por um campo textual resolvendo o nome falado contra os valores
// reais. Devolve `{ erro }` quando o nome e ambiguo ou desconhecido, para o
// agente perguntar em vez de responder sobre o projeto errado.
function filtrarPorNome(atividades, campo, consulta, rotulo, opcoesExtras = []) {
  if (!consulta) return { atividades, valorResolvido: null };

  const universo = [...new Set([...valoresDistintos(atividades, campo), ...opcoesExtras])];
  const resolucao = resolverEntidade(consulta, universo);

  if (!resolucao.encontrado) {
    if (resolucao.motivo === 'ambiguo') {
      return {
        erro: resultadoErro(
          `"${consulta}" pode ser mais de um ${rotulo}.`,
          {
            sugestao: `Pergunte ao usuário qual deles antes de responder.`,
            alternativas: resolucao.alternativas
          }
        )
      };
    }
    return {
      erro: resultadoErro(
        `Nenhum ${rotulo} corresponde a "${consulta}" no período consultado.`,
        {
          sugestao: 'Confirme o nome com o usuário ou ofereça as alternativas listadas.',
          alternativas: resolucao.alternativas
        }
      )
    };
  }

  return {
    atividades: atividades.filter(a => a[campo] === resolucao.valor),
    valorResolvido: resolucao.valor
  };
}

function resumirAtividade(a) {
  return {
    id: a.id,
    data: a.data,
    semana: a.semana,
    titulo: a.titulo,
    descricao: a.atividade,
    projeto: a.projeto,
    assunto: a.assuntoInterno,
    classificacao1: a.classNivel1,
    classificacao2: a.classNivel2,
    tempo: a.tempo
  };
}

export function criarAtividadesTools({
  listarAtividades,
  obterOpcoes,
  atividadeRepository,
  openAIGateway,
  embeddingsGateway,
  // Injetavel para os testes nao dependerem da data do relogio.
  hoje = () => new Date()
}) {
  async function carregarPeriodo({ userId, periodo }) {
    const intervalo = resolverPeriodo(periodo, { hoje: hoje() });

    if (intervalo.naoReconhecido) {
      return {
        erro: resultadoErro(
          `Não entendi o período "${periodo}".`,
          { sugestao: 'Peça ao usuário para reformular (ex.: "esta semana", um mês nomeado, ou um intervalo DD/MM a DD/MM).' }
        )
      };
    }

    const atividades = await listarAtividades({
      userId,
      semana: intervalo.semana || undefined,
      start: intervalo.start || undefined,
      end: intervalo.end || undefined
    });

    return { intervalo, atividades: atividades || [] };
  }

  async function opcoesSeguras() {
    try {
      const opcoes = await obterOpcoes();
      return opcoes || {};
    } catch (e) {
      // Falta de opcoes nao impede a consulta: a resolucao cai para os
      // valores presentes nas proprias atividades.
      console.log('Opções aviso:', e.message);
      return {};
    }
  }

  const consultarAtividades = definirFerramenta({
    nome: 'consultar_atividades',
    descricao:
      'Consulta as atividades registradas pelo usuário em um período, com filtros opcionais por ' +
      'projeto, assunto interno ou classificação. Retorna a lista das atividades E os totais de ' +
      'tempo já calculados. Use esta ferramenta para responder "o que eu fiz", "quanto tempo gastei" ' +
      'e qualquer pergunta que precise dos registros reais.',
    parametros: {
      type: 'object',
      properties: {
        periodo: PARAMETRO_PERIODO,
        projeto: {
          type: 'string',
          description: 'Nome do projeto como o usuário falou (ex.: "rede pro", "Tracbel"). Opcional.'
        },
        assunto: {
          type: 'string',
          description: 'Assunto interno como o usuário falou (ex.: "scraping", "atendimento"). Opcional.'
        },
        agruparPor: {
          type: 'string',
          enum: ['projeto', 'assuntoInterno', 'classNivel1', 'classNivel2'],
          description: 'Dimensão para quebrar os totais de tempo. Opcional.'
        },
        limite: {
          type: 'integer',
          description: 'Máximo de atividades detalhadas no retorno (padrão 50). Os totais sempre consideram todas.'
        }
      },
      required: []
    },
    executar: async ({ periodo, projeto, assunto, agruparPor, limite = 50 }, contexto) => {
      const carga = await carregarPeriodo({ userId: contexto.userId, periodo });
      if (carga.erro) return carga.erro;

      let { atividades } = carga;
      const { intervalo } = carga;
      const opcoes = await opcoesSeguras();
      const filtrosAplicados = {};

      if (projeto) {
        const r = filtrarPorNome(atividades, 'projeto', projeto, 'projeto', opcoes.projetos || []);
        if (r.erro) return r.erro;
        atividades = r.atividades;
        filtrosAplicados.projeto = r.valorResolvido;
      }

      if (assunto) {
        const r = filtrarPorNome(atividades, 'assuntoInterno', assunto, 'assunto interno', opcoes.assuntosInternos || []);
        if (r.erro) return r.erro;
        atividades = r.atividades;
        filtrosAplicados.assunto = r.valorResolvido;
      }

      // Totais SEMPRE sobre o conjunto completo do filtro, mesmo quando a
      // lista detalhada e truncada por `limite`. Truncar o total seria
      // reportar um numero errado.
      const totais = somarTempoAtividades(atividades, { agruparPor: agruparPor || null });

      return resultadoOk({
        periodo: intervalo.descricao,
        intervalo: { inicio: intervalo.start, fim: intervalo.end, semana: intervalo.semana || null },
        filtrosAplicados,
        totais,
        quantidadeTotal: atividades.length,
        // Ordem cronologica para o agente narrar a semana na sequencia certa.
        atividades: atividades
          .slice()
          .sort((a, b) => String(a.data).localeCompare(String(b.data)))
          .slice(0, limite)
          .map(resumirAtividade),
        truncado: atividades.length > limite
      }, {
        resumo: `${atividades.length} atividade(s), ${segundosParaTextoHumano(totais.totalSegundos)} no total.`
      });
    }
  });

  const listarVocabulario = definirFerramenta({
    nome: 'listar_vocabulario',
    descricao:
      'Lista os projetos, assuntos internos e classificações que o usuário tem cadastrados, ' +
      'e os que aparecem nas atividades do período. Use quando precisar confirmar o nome exato ' +
      'de um projeto, quando o usuário perguntar "em quais projetos eu trabalhei" ou quando uma ' +
      'consulta anterior não encontrou correspondência.',
    parametros: {
      type: 'object',
      properties: { periodo: PARAMETRO_PERIODO },
      required: []
    },
    executar: async ({ periodo }, contexto) => {
      const opcoes = await opcoesSeguras();
      const carga = await carregarPeriodo({ userId: contexto.userId, periodo });
      const atividades = carga.erro ? [] : carga.atividades;

      return resultadoOk({
        periodo: carga.erro ? null : carga.intervalo.descricao,
        cadastrados: {
          projetos: opcoes.projetos || [],
          assuntosInternos: opcoes.assuntosInternos || [],
          classificacoes: Object.keys(opcoes.classificacoes || {})
        },
        // O que o usuario REALMENTE usou no periodo costuma ser um conjunto
        // bem menor que o cadastro - e o mais util para sugerir opcoes.
        usadosNoPeriodo: {
          projetos: valoresDistintos(atividades, 'projeto'),
          assuntosInternos: valoresDistintos(atividades, 'assuntoInterno')
        }
      });
    }
  });

  const buscarSemelhantes = definirFerramenta({
    nome: 'buscar_atividades_semelhantes',
    descricao:
      'Busca semântica nas atividades do usuário, sem depender do período. Use quando o usuário ' +
      'descrever um trabalho por tema e não souber quando foi ("quando eu mexi com aquele scraping ' +
      'do Prosis?"), ou para encontrar trabalho recorrente em semanas anteriores.',
    parametros: {
      type: 'object',
      properties: {
        descricao: {
          type: 'string',
          description: 'Descrição do trabalho procurado, em linguagem natural.'
        },
        limite: { type: 'integer', description: 'Máximo de resultados (padrão 8).' }
      },
      required: ['descricao']
    },
    executar: async ({ descricao, limite = 8 }, contexto) => {
      const resultado = await tentarBuscarContextoRag(async () => {
        const embedding = await tentarGerarEmbedding({
          openAIGateway,
          embeddingsGateway,
          userId: contexto.userId,
          texto: descricao
        });
        if (!embedding) return null;

        const { data } = await atividadeRepository.buscarSimilares(embedding, {
          userId: contexto.userId,
          limite
        });
        return data || [];
      });

      if (!resultado) {
        return resultadoErro(
          'A busca semântica não está disponível no momento.',
          { sugestao: 'Use consultar_atividades com um período específico.' }
        );
      }

      return resultadoOk({
        encontradas: resultado.map(a => ({
          id: a.id,
          titulo: a.titulo,
          descricao: a.atividade,
          projeto: a.projeto,
          assunto: a.assunto_interno,
          semana: a.semana,
          similaridade: Number((a.similarity ?? 0).toFixed(3))
        }))
      }, { resumo: `${resultado.length} atividade(s) semelhante(s).` });
    }
  });

  return [consultarAtividades, listarVocabulario, buscarSemelhantes];
}
