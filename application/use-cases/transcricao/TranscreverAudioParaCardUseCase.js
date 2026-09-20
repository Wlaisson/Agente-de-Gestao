import { formatarListasParaPrompt } from './formatarListasParaPrompt.js';
import { parseLlmJson } from '../../../shared/parseLlmJson.js';
import { enviarParaWebhookLegado } from '../../../interface-adapters/gateways/GoogleSheetsWebhookGateway.js';
import { montarSystemPrompt } from '../../../shared/promptBuilder.js';
import { tentarGerarEmbedding, tentarBuscarContextoRag } from '../../../shared/embeddingHelpers.js';
import {
  TRANSCRICAO_CARD_PERSONA,
  TRANSCRICAO_CARD_NEGATIVAS,
  TRANSCRICAO_CARD_EXEMPLOS,
  montarSchemaJsonTranscricaoCard
} from './transcricaoCardPromptConfig.js';

function formatarContextoCardsSimilares(cards) {
  if (!cards || cards.length === 0) return '';
  const linhas = cards.map(c =>
    `- [status ${c.status}] "${c.titulo}" (assunto: ${c.assunto_interno || 'N/A'}, projeto: ${c.projeto || 'N/A'})`
  );
  return 'Tarefas semelhantes já existentes no Kanban (evite recriar algo que já está em andamento; referência, não copie literalmente):\n' + linhas.join('\n');
}

// Transcreve o audio e extrai N tarefas para o Kanban. Reescrito para usar
// prompt-como-codigo (persona/negativas/exemplos/schema em
// transcricaoCardPromptConfig.js) + RAG via pgvector (busca cards
// semelhantes ja existentes) + CoT oculto (campo "raciocinio", nunca
// persistido nem retornado). O caminho de escrita (upsert/webhook/cache
// local) nao foi alterado nesta fase - so a construcao do prompt.
export function makeTranscreverAudioParaCardUseCase({ openAIGateway, embeddingsGateway, opcoesRepository, kanbanRepository }) {
  return async function transcreverAudioParaCard({ userId, file }) {
    let openAiConfig;
    try {
      openAiConfig = await openAIGateway.obterCliente(userId);
    } catch (errSetup) {
      const erro = new Error(errSetup.message);
      erro.status = 400;
      throw erro;
    }

    const transcricao = await openAIGateway.transcreverAudio({
      openai: openAiConfig.openai,
      buffer: file.buffer,
      filename: file.originalname,
      mimetype: file.mimetype
    });

    const textoCompleto = transcricao.text ? transcricao.text.trim() : '';

    if (!textoCompleto) {
      const erro = new Error('Nenhuma fala foi identificada no áudio. Fale mais próximo ao microfone e tente novamente.');
      erro.status = 400;
      throw erro;
    }

    const opcoes = await opcoesRepository.carregar();
    const { projetosStr, assuntosStr, classificacoesStr } = formatarListasParaPrompt(opcoes);

    const contextoRag = await tentarBuscarContextoRag(async () => {
      const embeddingConsulta = await tentarGerarEmbedding({ openAIGateway, embeddingsGateway, userId, texto: textoCompleto });
      if (!embeddingConsulta) return '';
      const { data: cardsSimilares } = await kanbanRepository.buscarSimilares(embeddingConsulta, { userId, limite: 5 });
      return formatarContextoCardsSimilares(cardsSimilares);
    });

    const persona = `${TRANSCRICAO_CARD_PERSONA}

Lista de projetos válidos (retorne exatamente como escrito aqui):
${projetosStr}

Lista de assuntos internos válidos (retorne exatamente como escrito aqui):
${assuntosStr}

Lista de combinações válidas de Classificação nível 1 / Classificação nível 2 (escolha exatamente um par desta lista):
${classificacoesStr}`;

    const systemPrompt = montarSystemPrompt({
      persona,
      negativas: TRANSCRICAO_CARD_NEGATIVAS,
      poucosExemplos: TRANSCRICAO_CARD_EXEMPLOS,
      schemaJson: montarSchemaJsonTranscricaoCard(),
      contextoRag
    });

    let jsonResult = null;
    try {
      const completions = await openAIGateway.chamarModelo({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Texto transcrito:\n"${textoCompleto}"` }
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      }, openAiConfig.openai, openAiConfig.modelos);

      const respostaTexto = completions.choices[0].message.content.trim();
      jsonResult = parseLlmJson(respostaTexto).resultado;
    } catch (errIa) {
      console.error('Falha nos modelos de IA para Kanban:', errIa);
    }

    if (!jsonResult || !Array.isArray(jsonResult.tarefas) || jsonResult.tarefas.length === 0) {
      jsonResult = {
        tarefas: [{
          titulo: 'Nova Tarefa Registrada',
          descricao: 'Demanda capturada via áudio para detalhamento e execução.',
          projeto: 'Interno',
          assunto_interno: '',
          classNivel1: '',
          classNivel2: '',
          prioridade: 'Média',
          prazo: ''
        }]
      };
    }

    const cards = await kanbanRepository.listarCards();
    const tarefasSalvas = [];
    const hojeStr = new Date().toISOString().split('T')[0];

    for (const tarefa of (jsonResult.tarefas || [jsonResult])) {
      const novoCard = {
        id: `K-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        titulo: tarefa.titulo || 'Nova Tarefa',
        descricao: tarefa.descricao || '',
        projeto: tarefa.projeto || '',
        assuntoInterno: tarefa.assunto_interno || tarefa.assuntoInterno || '',
        classNivel1: tarefa.classNivel1 || '',
        classNivel2: tarefa.classNivel2 || '',
        prioridade: tarefa.prioridade || 'Média',
        status: 'A Fazer',
        dataCriacao: hojeStr,
        prazo: tarefa.prazo || '',
        tempo: ''
      };

      cards.unshift(novoCard);
      tarefasSalvas.push(novoCard);

      await kanbanRepository.upsertSupabase({
        id: novoCard.id,
        titulo: novoCard.titulo,
        descricao: novoCard.descricao,
        projeto: novoCard.projeto,
        assunto_interno: novoCard.assuntoInterno,
        class_nivel_1: novoCard.classNivel1,
        class_nivel_2: novoCard.classNivel2,
        prioridade: novoCard.prioridade,
        status: 'A Fazer',
        data_criacao: novoCard.dataCriacao,
        prazo: novoCard.prazo,
        tempo: '',
        updated_at: new Date().toISOString()
      });

      enviarParaWebhookLegado({
        action: 'add_kanban',
        titulo: novoCard.titulo,
        descricao: novoCard.descricao,
        projeto: novoCard.projeto,
        assunto_interno: novoCard.assuntoInterno,
        classNivel1: novoCard.classNivel1,
        classNivel2: novoCard.classNivel2,
        prioridade: novoCard.prioridade,
        prazo: novoCard.prazo,
        status: 'A Fazer'
      });
    }

    kanbanRepository.salvarCardsLocais(cards);

    return tarefasSalvas;
  };
}
