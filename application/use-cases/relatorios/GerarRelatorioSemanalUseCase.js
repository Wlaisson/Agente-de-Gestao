import { agruparPorAssunto } from '../../../domain/services/AgruparAtividadesPorAssunto.js';
import { parseLlmJson } from '../../../shared/parseLlmJson.js';
import { WEBHOOK_URL } from '../../../config/env.js';

// As duas rotas de relatorio semanal (/api/gerar-relatorio e
// /api/gerar-relatorio-reporter) compartilhavam ~70% de logica identica no
// server.js original: buscar atividades da semana no Supabase, cair para o
// fallback do Google Sheets se vazio, e agrupar por assunto interno. Um so
// use-case agora, parametrizado por `modo` ('consolidado' | 'reporter') -
// o unico ponto real de divergencia entre as duas rotas (prompt e formato
// de saida). URLs/verbos das duas rotas continuam identicos, so a logica
// interna foi unificada.
export function makeGerarRelatorioSemanalUseCase({ atividadeRepository, openAIGateway }) {
  async function buscarEAgrupar({ userId, semana }) {
    let listaAtividades = [];

    try {
      const { data: atvsDb } = await atividadeRepository.listarPorSemana(userId, semana);
      if (atvsDb && atvsDb.length > 0) {
        listaAtividades = atvsDb.map(a => ({
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

    const systemPrompt = `Você é um Tech Lead responsável por criar um relatório executivo semanal formal e técnico.
Abaixo, você receberá uma lista de micro-atividades técnicas realizadas na semana.

Sua tarefa é analisar todas as atividades e agrupá-las em grandes tópicos (Ex: "Automações e Inteligência Artificial", "Atendimentos", etc) seguindo as regras abaixo:

Diretrizes de Inteligência:
1. FORMALIDADE E CONCISÃO: A linguagem deve ser técnica, formal e "direta ao ponto" (ex: "Desenvolvimento de automação para...", "Correção de erros no software..."). Sem enrolação.
2. FILTRO RIGOROSO (O QUE NÃO INCLUIR): Ignore completamente e NÃO INCLUA:
   - "Daily" ou "Daily Meeting"
   - "Weekly" ou reuniões de status semanais
   - Apresentações em geral (ex: "Apresentação para Everton", "Apresentação para IA", etc.)
   - Reuniões que não sejam "Atendimentos" técnicos a clientes ou parceiros (como RedePRO, Agrominas, etc).
3. CONSOLIDAÇÃO: Se houver múltiplas atividades sobre o mesmo assunto/tarefa (ex: vários atendimentos à RedePRO), UNA todas elas em uma única atividade bem resumida. Não liste várias vezes a mesma coisa.
4. ESTRUTURAÇÃO: Agrupe os itens restantes em categorias amplas (o 'titulo' do JSON será o nome da categoria). Na 'descricao', liste as atividades no formato HTML. NÃO use a palavra "Título:" nem "Descrição:". Use este formato exato:
   "<ul><li><strong>[Nome da Atividade/Assunto]:</strong> [Texto consolidado e direto da atividade, unindo tudo que for do mesmo assunto]. (Status)</li></ul>"
5. CORREÇÃO ORTOGRÁFICA: Sempre que a atividade mencionar "Process", corrija para o nome correto do software: "Prosis".

Formato de Saída Obrigatório (Gere um Objeto JSON, seguindo este esqueleto):
{
  "relatorio": [
    {
      "titulo": "Automações e Inteligência Artificial",
      "descricao": "<ul><li><strong>Software Prosis:</strong> Correção de falhas e monitoramento contínuo da extração de dados. (Concluído)</li></ul>"
    }
  ]
}

CRÍTICO E MANDATÓRIO:
1. Você é uma API de conversão de dados. O sistema depende que sua resposta seja EXCLUSIVAMENTE um JSON válido.
2. É ESTRITAMENTE PROIBIDO gerar qualquer texto de raciocínio, explicação, ou "thinking process".
3. O formato deve ser um objeto JSON puro.`;

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
      resumoArray = resultado.relatorio || resultado;
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

    const systemPrompt = `Você é um Chief of Staff virtual que prepara relatórios executivos semanais para CEOs e gestores seniores.

Você receberá atividades já agrupadas por "Assunto Interno". Sua tarefa é produzir um relatório executivo de alto nível, aplicando consolidação inteligente.

## POLÍTICA DE CONSOLIDAÇÃO (CRÍTICA):

CONSOLIDAR (unir em 1 item):
- Múltiplas linhas que tratam do MESMO tema, tarefa ou processo (ex: "Tratamento de atributos IA lote 1", "Tratamento de atributos IA lote 2", "Avaliação de atributos gerados por IA" → unir tudo em "Tratamento e Avaliação de Atributos via IA").
- Atividades que são etapas ou desdobramentos de um mesmo fluxo de trabalho.
- Tarefas repetitivas do dia-a-dia sobre o mesmo assunto.

MANTER SEPARADO:
- Reuniões sobre assuntos DISTINTOS (ex: "Reunião Academy" vs "Reunião com Gustavo e Renato" são 2 itens distintos).
- Atividades que envolvem temas, clientes ou entregas fundamentalmente diferentes.
- Qualquer item que, se fundido com outro, perderia informação relevante para um gestor.

## REGRAS DE FORMATAÇÃO:

1. MANTER os agrupamentos por assunto interno EXATAMENTE como recebidos. NÃO invente novos assuntos, NÃO mescle assuntos diferentes.
2. Para cada item (consolidado ou individual), gere:
   - "titulo": Título executivo, claro e direto (máximo 8 palavras). Se consolidou várias atividades, crie um título que abranja todas.
   - "resumo": Resumo executivo em 1-3 frases. Linguagem formal, terceira pessoa, foco em RESULTADOS e ENTREGAS, não em processo. Se consolidou, mencione o escopo completo. Se houver informação de projeto/cliente, incorpore naturalmente.
3. Corrija "Process" para "Prosis".
4. NÃO inclua: dailies, weeklies, reuniões de status rotineiras, ou atividades puramente administrativas triviais.

## TOM:
- Executivo e conciso. Cada frase deve agregar valor para quem lê.
- Foco em: o que foi feito, para quem, e qual o impacto/resultado.
- Evite jargões técnicos excessivos — um CEO deve entender.

Formato de Saída OBRIGATÓRIO (JSON puro, sem markdown):
{
  "quadrantes": [
    {
      "assunto": "Nome do Assunto Interno",
      "itens": [
        { "titulo": "Título Executivo", "resumo": "Resumo executivo conciso." }
      ]
    }
  ]
}

REGRAS CRÍTICAS:
- Retorne EXCLUSIVAMENTE o JSON. Nenhum texto adicional, nenhum raciocínio, nenhum markdown.
- Mantenha TODOS os assuntos internos recebidos, mesmo que tenham apenas 1 atividade.
- Dentro de cada assunto, o número de itens finais pode ser MENOR que o número de atividades recebidas (por causa da consolidação), mas NUNCA maior.`;

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
      quadrantesArray = resultado.quadrantes || resultado;
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
