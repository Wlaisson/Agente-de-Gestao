import { formatarListasParaPrompt } from './formatarListasParaPrompt.js';
import { parseLlmJson } from '../../../shared/parseLlmJson.js';
import { enviarParaWebhookLegado } from '../../../interface-adapters/gateways/GoogleSheetsWebhookGateway.js';

// Portado verbatim de POST /api/transcrever-kanban.
export function makeTranscreverAudioParaCardUseCase({ openAIGateway, opcoesRepository, kanbanRepository }) {
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

    const systemPrompt = `Você é um assistente de gestão de projetos que extrai TAREFAS PENDENTES a partir de áudio para um Quadro Kanban.
O usuário vai ditar tarefas que PRECISAM SER FEITAS (não são atividades já concluídas).

Sua tarefa é interpretar o texto e retornar APENAS um objeto JSON válido com a seguinte estrutura:

{
  "tarefas": [
    {
      "titulo": "Título curto, executivo e acionável da tarefa (máximo 8 palavras, comece preferencialmente com verbo no infinitivo: Implementar, Corrigir, Revisar, Configurar, etc.)",
      "descricao": "Descrição detalhada do que precisa ser feito, com contexto relevante em terceira pessoa.",
      "projeto": "SELECIONE OBRIGATORIAMENTE um projeto corporativo da lista abaixo. Se não mencionado ou incerto, use 'Interno' ou deixe vazio.",
      "assunto_interno": "SELECIONE OBRIGATORIAMENTE um 'Assunto Interno' da 'Lista de assuntos internos válidos' no final deste prompt. Não invente assuntos novos, selecione o mais correspondente da lista.",
      "classNivel1": "SELECIONE OBRIGATORIAMENTE uma 'Classificação nível 1' a partir da lista fornecida abaixo.",
      "classNivel2": "SELECIONE OBRIGATORIAMENTE uma 'Classificação nível 2' que corresponda à 'Classificação nível 1' escolhida, baseando-se EXATAMENTE nas combinações da lista abaixo.",
      "prioridade": "Alta, Média ou Baixa (infira pela urgência e tom do áudio, use Média como padrão)",
      "prazo": "Data no formato YYYY-MM-DD se mencionada no áudio, ou vazio se não houver"
    }
  ]
}

Se o usuário mencionar MÚLTIPLAS tarefas, divida e extraia TODAS como itens separados no array.
Se mencionar apenas UMA tarefa, retorne um array com 1 item.

Lista de projetos válidos (retorne exatamente como escrito aqui):
${projetosStr}

Lista de assuntos internos válidos (retorne exatamente como escrito aqui):
${assuntosStr}

Lista de combinações válidas de Classificação nível 1 / Classificação nível 2 (escolha exatamente um par desta lista):
${classificacoesStr}

Regras fonéticas e de correção:
- Corrija "Process" ou "Proces" para "Prosis".
- Corrija "Via Mar" para "Viamar".
- Corrija "Rede Pro" para "Rede Pró".

Retorne APENAS o JSON, sem formatação markdown ou textos adicionais.`;

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
