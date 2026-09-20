import { enviarParaWebhookLegado } from '../../../interface-adapters/gateways/GoogleSheetsWebhookGateway.js';
import { tentarGerarEmbedding, tentarBuscarContextoRag } from '../../../shared/embeddingHelpers.js';
import { montarSystemPrompt } from '../../../shared/promptBuilder.js';
import { parseLlmJson } from '../../../shared/parseLlmJson.js';
import { REUNIAO_PERSONA, REUNIAO_NEGATIVAS, REUNIAO_EXEMPLOS, REUNIAO_SCHEMA_JSON } from './reuniaoPromptConfig.js';

// Filtra placeholders/junk que a IA as vezes devolve (reticencias, ou o eco
// literal dos nomes dos campos do schema JSON como se fossem valores).
// Portado verbatim (era uma funcao aninhada dentro da rota original).
function sanitizarTexto(val) {
  if (!val) return '';
  const trimmed = val.trim();
  const placeholders = ['...', '\u2026', 'descri\u00e7\u00e3o da tarefa', 'contexto da tarefa', 'prazo', 'nome da reuni\u00e3o', 'data da reuni\u00e3o', 'resumo extra\u00eddo'];
  if (placeholders.includes(trimmed.toLowerCase())) return '';
  return trimmed;
}

function formatarContextoRag(atividadesSimilares, cardsSimilares) {
  const linhas = [];
  for (const a of atividadesSimilares || []) {
    linhas.push(`- [Atividade registrada] ${a.titulo || a.atividade} (assunto: ${a.assunto_interno || 'N/A'}, projeto: ${a.projeto || 'N/A'})`);
  }
  for (const c of cardsSimilares || []) {
    linhas.push(`- [Card no Kanban, status ${c.status}] ${c.titulo} (assunto: ${c.assunto_interno || 'N/A'})`);
  }
  if (linhas.length === 0) return '';
  return 'Itens já rastreados que podem se relacionar ao que foi dito nesta reunião (use para reconhecer o que já está em andamento vs. o que é genuinamente novo):\n' + linhas.join('\n');
}

// Extrai minhas_tarefas da transcricao de uma reuniao. Reescrito para usar
// prompt-como-codigo (persona/negativas/exemplos/schema em
// reuniaoPromptConfig.js) + RAG via pgvector (busca atividades e cards
// semelhantes a transcricao para dar contexto ao modelo) + CoT oculto (campo
// "raciocinio", nunca retornado ao cliente - ver whitelist explicito abaixo).
export function makeProcessarReuniaoUseCase({ openAIGateway, embeddingsGateway, atividadeRepository, kanbanRepository }) {
  return async function processarReuniao({ userId, nome_reuniao, data_reuniao, transcricao }) {
    let openAiConfig;
    try {
      openAiConfig = await openAIGateway.obterCliente(userId);
    } catch (errSetup) {
      const erro = new Error(errSetup.message);
      erro.status = 400;
      throw erro;
    }

    const contextoRag = await tentarBuscarContextoRag(async () => {
      const embeddingConsulta = await tentarGerarEmbedding({ openAIGateway, embeddingsGateway, userId, texto: transcricao });
      if (!embeddingConsulta) return '';

      const [{ data: atividadesSimilares }, { data: cardsSimilares }] = await Promise.all([
        atividadeRepository.buscarSimilares(embeddingConsulta, { userId, limite: 5 }),
        kanbanRepository.buscarSimilares(embeddingConsulta, { userId, limite: 5 })
      ]);
      return formatarContextoRag(atividadesSimilares, cardsSimilares);
    });

    const systemPrompt = montarSystemPrompt({
      persona: REUNIAO_PERSONA,
      negativas: REUNIAO_NEGATIVAS,
      poucosExemplos: REUNIAO_EXEMPLOS,
      schemaJson: REUNIAO_SCHEMA_JSON,
      contextoRag
    });

    const completions = await openAIGateway.chamarModelo({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Dados da Agenda:\nNome da Reunião: ${nome_reuniao || 'Não informado'}\nData: ${data_reuniao || 'Não informada'}\n\nTexto da Transcrição:\n${transcricao}` }
      ],
      temperature: 0.2,
      max_tokens: 4000
    }, openAiConfig.openai, openAiConfig.modelos);

    const respostaTexto = completions.choices[0].message.content.trim();
    const { resultado } = parseLlmJson(respostaTexto);
    const dados = resultado || { nome_reuniao, data_reuniao, resumo_geral: '', minhas_tarefas: [] };

    // Whitelist explicito: garante que "raciocinio" (exigido pelo CoT
    // oculto) jamais chegue ao frontend, e preserva o contrato de resposta
    // exato de antes ({nome_reuniao, data_reuniao, resumo_geral, minhas_tarefas}).
    const jsonResult = {
      nome_reuniao: sanitizarTexto(dados.nome_reuniao) || nome_reuniao || '',
      data_reuniao: sanitizarTexto(dados.data_reuniao) || data_reuniao || '',
      resumo_geral: sanitizarTexto(dados.resumo_geral),
      minhas_tarefas: (Array.isArray(dados.minhas_tarefas) ? dados.minhas_tarefas : [])
        .map(t => ({
          tarefa: sanitizarTexto(t.tarefa),
          contexto: sanitizarTexto(t.contexto),
          prazo_mencionado: sanitizarTexto(t.prazo_mencionado)
        }))
        .filter(t => t.tarefa.length > 0)
    };

    for (const tarefaObj of jsonResult.minhas_tarefas) {
      await enviarParaWebhookLegado({
        action: 'add_tasks',
        nome_reuniao: jsonResult.nome_reuniao,
        data_reuniao: jsonResult.data_reuniao,
        tarefa: tarefaObj.tarefa,
        contexto: tarefaObj.contexto,
        prazo: tarefaObj.prazo_mencionado
      });
    }

    return jsonResult;
  };
}
