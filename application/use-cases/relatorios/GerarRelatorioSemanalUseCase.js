import { agruparPorAssunto } from '../../../domain/services/AgruparAtividadesPorAssunto.js';
import { parseLlmJson } from '../../../shared/parseLlmJson.js';
import { WEBHOOK_URL } from '../../../config/env.js';
import { montarSystemPrompt } from '../../../shared/promptBuilder.js';
import { tentarGerarEmbedding, tentarBuscarContextoRag } from '../../../shared/embeddingHelpers.js';
import {
  RELATORIO_CONSOLIDADO_PERSONA,
  RELATORIO_CONSOLIDADO_NEGATIVAS,
  RELATORIO_CONSOLIDADO_EXEMPLOS,
  montarSchemaJsonRelatorioConsolidado,
  RELATORIO_REPORTER_PERSONA,
  RELATORIO_REPORTER_NEGATIVAS,
  RELATORIO_REPORTER_EXEMPLOS,
  montarSchemaJsonRelatorioReporter
} from './relatorioPromptConfig.js';

// Formata o contexto RAG de complemento: atividades semelhantes registradas em
// OUTRAS semanas (a busca exata por semana em buscarEAgrupar continua sendo a
// fonte primaria - exata e mais precisa que fuzzy para "o que aconteceu nesta
// semana"). Exclui pelo id qualquer atividade que ja esteja na semana atual.
function formatarContextoSemanasAnteriores(atividadesSimilares, idsSemanaAtual) {
  const filtradas = (atividadesSimilares || []).filter(a => !idsSemanaAtual.has(a.id));
  if (filtradas.length === 0) return '';
  const linhas = filtradas.map(a =>
    `- [Semana ${a.semana || 'N/A'}] "${a.titulo}" (assunto: ${a.assunto_interno || 'N/A'}, projeto: ${a.projeto || 'N/A'})`
  );
  return 'Padrões de semanas anteriores (atividades semelhantes já registradas em outras semanas - use apenas para reconhecer trabalho recorrente; a fonte primária desta semana é a lista de atividades acima):\n' + linhas.join('\n');
}

// As duas rotas de relatorio semanal (/api/gerar-relatorio e
// /api/gerar-relatorio-reporter) compartilhavam ~70% de logica identica no
// server.js original: buscar atividades da semana no Supabase, cair para o
// fallback do Google Sheets se vazio, e agrupar por assunto interno. Um so
// use-case agora, parametrizado por `modo` ('consolidado' | 'reporter') -
// o unico ponto real de divergencia entre as duas rotas (prompt e formato
// de saida). URLs/verbos das duas rotas continuam identicos, so a logica
// interna foi unificada. Reescrito para usar prompt-como-codigo
// (relatorioPromptConfig.js) + RAG via pgvector (padroes de semanas
// anteriores) + CoT oculto (campo "raciocinio", nunca retornado - whitelist
// explicito em cada item de saida).
export function makeGerarRelatorioSemanalUseCase({ atividadeRepository, openAIGateway, embeddingsGateway }) {
  async function buscarEAgrupar({ userId, semana }) {
    let listaAtividades = [];

    try {
      const { data: atvsDb } = await atividadeRepository.listarPorSemana(userId, semana);
      if (atvsDb && atvsDb.length > 0) {
        listaAtividades = atvsDb.map(a => ({
          id: a.id,
          titulo: a.titulo,
          descricao: a.atividade,
          assuntoInterno: a.assunto_interno,
          projeto: a.projeto,
          tempo: a.tempo
        }));
      }
    } catch (eDb) {
      console.log('Erro ao buscar do Supabase, tentando Sheets fallback:', eDb.message);
    }

    if (listaAtividades.length === 0) {
      try {
        const sheetRes = await fetch(`${WEBHOOK_URL}?action=semana-relatorio&semana=${encodeURIComponent(semana)}`);
        const sheetData = await sheetRes.json();
        if (sheetData && sheetData.status === 'success' && Array.isArray(sheetData.atividades)) {
          listaAtividades = sheetData.atividades;
        }
      } catch (eSheet) {
        console.log('Erro no fallback do Sheets:', eSheet.message);
      }
    }

    return { listaAtividades, agrupado: agruparPorAssunto(listaAtividades) };
  }

  async function buscarContextoSemanasAnteriores({ userId, listaAtividades }) {
    return tentarBuscarContextoRag(async () => {
      const digest = listaAtividades.map(a => `${a.titulo || ''} ${a.assuntoInterno || ''}`).join('. ');
      const embeddingConsulta = await tentarGerarEmbedding({ openAIGateway, embeddingsGateway, userId, texto: digest });
      if (!embeddingConsulta) return '';
      const idsSemanaAtual = new Set(listaAtividades.map(a => a.id).filter(Boolean));
      const { data: atividadesSimilares } = await atividadeRepository.buscarSimilares(embeddingConsulta, { userId, limite: 8 });
      return formatarContextoSemanasAnteriores(atividadesSimilares, idsSemanaAtual);
    });
  }

  async function gerarConsolidado({ userId, semana, openAiConfig }) {
    const { listaAtividades, agrupado } = await buscarEAgrupar({ userId, semana });

    if (listaAtividades.length === 0) {
      return { status: 'empty', resumo: [], message: 'Nenhuma atividade encontrada para esta semana.' };
    }

    let textoAgrupado = '';
    for (const assunto in agrupado) {
      textoAgrupado += `[Assunto: ${assunto}]\n`;
      for (const atv of agrupado[assunto]) {
        textoAgrupado += `- Título: ${atv.titulo || 'Sem título'}\n`;
        textoAgrupado += `- Descrição: ${atv.descricao || 'Sem descrição'}\n`;
      }
      textoAgrupado += '\n';
    }

    const contextoRag = await buscarContextoSemanasAnteriores({ userId, listaAtividades });

    const systemPrompt = montarSystemPrompt({
      persona: RELATORIO_CONSOLIDADO_PERSONA,
      negativas: RELATORIO_CONSOLIDADO_NEGATIVAS,
      poucosExemplos: RELATORIO_CONSOLIDADO_EXEMPLOS,
      schemaJson: montarSchemaJsonRelatorioConsolidado(),
      contextoRag
    });

    const completions = await openAIGateway.chamarModelo({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Dados desta semana:\n${textoAgrupado}` }
      ],
      temperature: 0.1,
      max_tokens: 3500,
      response_format: { type: 'json_object' }
    }, openAiConfig.openai, openAiConfig.modelos);

    const respostaTexto = completions.choices[0].message.content.trim();
    const { resultado } = parseLlmJson(respostaTexto);

    let resumoArray;
    if (resultado) {
      const bruto = resultado.relatorio || resultado;
      // Whitelist explicito: garante que "raciocinio" (exigido pelo CoT
      // oculto) jamais chegue ao frontend, preservando o contrato de resposta
      // exato de antes ({titulo, descricao} por item).
      resumoArray = Array.isArray(bruto)
        ? bruto.map(item => ({ titulo: item.titulo ?? '', descricao: item.descricao ?? '' }))
        : bruto;
    } else {
      resumoArray = [{ titulo: 'Erro de Formatação', descricao: 'A IA retornou um formato inválido. Texto bruto gerado:\n' + respostaTexto }];
    }

    return { status: 'success', resumo: resumoArray, semana };
  }

  async function gerarReporter({ userId, semana, openAiConfig }) {
    const { listaAtividades, agrupado } = await buscarEAgrupar({ userId, semana });

    if (listaAtividades.length === 0) {
      return { status: 'empty', quadrantes: [], message: 'Nenhuma atividade encontrada para esta semana.' };
    }

    let textoAgrupado = '';
    for (const assunto in agrupado) {
      textoAgrupado += `[Assunto Interno: ${assunto}]\n`;
      for (const atv of agrupado[assunto]) {
        textoAgrupado += `- Título: ${atv.titulo || 'Sem título'}`;
        if (atv.projeto) textoAgrupado += ` | Projeto: ${atv.projeto}`;
        if (atv.tempo) textoAgrupado += ` | Tempo: ${atv.tempo}`;
        textoAgrupado += `\n`;
        textoAgrupado += `  Descrição: ${atv.descricao || 'Sem descrição'}\n`;
      }
      textoAgrupado += '\n';
    }

    const contextoRag = await buscarContextoSemanasAnteriores({ userId, listaAtividades });

    const systemPrompt = montarSystemPrompt({
      persona: RELATORIO_REPORTER_PERSONA,
      negativas: RELATORIO_REPORTER_NEGATIVAS,
      poucosExemplos: RELATORIO_REPORTER_EXEMPLOS,
      schemaJson: montarSchemaJsonRelatorioReporter(),
      contextoRag
    });

    const completions = await openAIGateway.chamarModelo({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Atividades da semana:\n${textoAgrupado}` }
      ],
      temperature: 0.1,
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    }, openAiConfig.openai, openAiConfig.modelos);

    const respostaTexto = completions.choices[0].message.content.trim();
    const { resultado } = parseLlmJson(respostaTexto);

    let quadrantesArray;
    if (resultado) {
      const bruto = resultado.quadrantes || resultado;
      // Whitelist explicito: garante que "raciocinio" jamais chegue ao
      // frontend, tanto no nivel do quadrante quanto de cada item.
      quadrantesArray = Array.isArray(bruto)
        ? bruto.map(q => ({
            assunto: q.assunto ?? '',
            itens: Array.isArray(q.itens) ? q.itens.map(item => ({ titulo: item.titulo ?? '', resumo: item.resumo ?? '' })) : []
          }))
        : bruto;
    } else {
      quadrantesArray = [];
      for (const assunto in agrupado) {
        const itens = agrupado[assunto].map(atv => ({
          titulo: atv.titulo || 'Sem título',
          resumo: atv.descricao || ''
        }));
        quadrantesArray.push({ assunto, itens });
      }
    }

    return { status: 'success', quadrantes: quadrantesArray, semana };
  }

  return async function gerarRelatorioSemanal({ userId, semana, modo, openAiConfig }) {
    return modo === 'reporter'
      ? gerarReporter({ userId, semana, openAiConfig })
      : gerarConsolidado({ userId, semana, openAiConfig });
  };
}
