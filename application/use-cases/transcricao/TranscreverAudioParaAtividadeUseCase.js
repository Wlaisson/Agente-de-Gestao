import { formatarListasParaPrompt } from './formatarListasParaPrompt.js';
import { parseLlmJson } from '../../../shared/parseLlmJson.js';

// Portado verbatim de POST /api/transcrever.
export function makeTranscreverAudioParaAtividadeUseCase({ openAIGateway, opcoesRepository }) {
  return async function transcreverAudioParaAtividade({ userId, file }) {
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

    const textoCompleto = transcricao.text;

    const opcoes = await opcoesRepository.carregar();
    const { projetosStr, assuntosStr, classificacoesStr } = formatarListasParaPrompt(opcoes);

    const systemPrompt = `Você é um assistente executivo de alta senioridade, especializado em registrar atividades corporativas e de engenharia/produto com linguagem formal, concisa e altamente profissional.
Receberás a transcrição falada de um relato de atividade de um profissional. Transcrições de voz frequentemente contêm correções espontâneas ("ou melhor", "digo"), hesitações, gírias e linguagem informal ("a gente", "né").

Sua obrigação é filtrar esses vícios e transformar o relato em um registro técnico e executivo impecável.

Retorne EXCLUSIVAMENTE um objeto JSON válido com os seguintes campos:

{
  "projeto_oficial": "Identifique e selecione o projeto EXATO da 'Lista de Projetos Válidos'. Se o usuário mencionar 'projeto interno' ou 'interno', mapeie para 'Interno'.",
  "assunto_interno": "Identifique e selecione o assunto interno EXATO da 'Lista de Assuntos Internos Válidos'. Ex: se o usuário falar 'agente de aplicação', selecione 'Agente de Aplicações'. Se falar 'reunião com fulano', selecione o assunto correspondente.",
  "titulo": "Crie um título executivo de alto nível, sintético e profissional (3 a 6 palavras) que resuma o núcleo da atividade. NUNCA use palavras truncadas e NUNCA copie o início da transcrição.",
  "descricao": "Redija um resumo formal, objetivo e detalhado em terceira pessoa (voz passiva executiva, ex: 'Realizada reunião...', 'Alinhamento com...', 'Desenvolvido...'). Elimine vícios de fala, redundâncias e informalidades. Destaque com clareza o objetivo, as deliberações técnicas e os desdobramentos práticos.",
  "tempo": "Extraia o tempo final mencionado no formato HH:MM:SS. Ex: se mencionou '20 minutos, 25 minutos', adote 00:25:00. Padrão: 01:00:00 se não especificado.",
  "classNivel1": "Selecione o Nível 1 da combinação mais aderente da lista.",
  "classNivel2": "Selecione o Nível 2 correspondente ao Nível 1 escolhido da lista."
}

Lista de Projetos Válidos:
${projetosStr}

Lista de Assuntos Internos Válidos:
${assuntosStr}

Lista de Combinações de Classificação (Nível 1 / Nível 2):
${classificacoesStr}

Diretrizes Críticas:
1. Jamais devolva a transcrição crua na descrição.
2. Jamais trunque frases no título.
3. O JSON deve ser 100% puro e parseável.`;

    const completions = await openAIGateway.chamarModelo({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Relato transcrito:\n"${textoCompleto}"` }
      ],
      temperature: 0.1,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    }, openAiConfig.openai, openAiConfig.modelos);

    const respostaTexto = completions.choices[0].message.content.trim();
    const { resultado, textoLimpo } = parseLlmJson(respostaTexto);
    let jsonResult = resultado;

    if (!jsonResult) {
      const matchTitulo = textoLimpo.match(/"titulo"\s*:\s*"([^"]+)"/i);
      const matchDesc = textoLimpo.match(/"descricao"\s*:\s*"([^"]+)"/i);
      const matchProj = textoLimpo.match(/"projeto_oficial"\s*:\s*"([^"]+)"/i);
      const matchAssunto = textoLimpo.match(/"assunto_interno"\s*:\s*"([^"]+)"/i);
      const matchTempo = textoLimpo.match(/"tempo"\s*:\s*"([^"]+)"/i);
      const matchC1 = textoLimpo.match(/"classNivel1"\s*:\s*"([^"]+)"/i);
      const matchC2 = textoLimpo.match(/"classNivel2"\s*:\s*"([^"]+)"/i);

      jsonResult = {
        projeto_oficial: matchProj ? matchProj[1] : 'Interno',
        assunto_interno: matchAssunto ? matchAssunto[1] : '',
        titulo: matchTitulo ? matchTitulo[1] : 'Registro de Atividade',
        descricao: matchDesc ? matchDesc[1] : 'Atividade realizada conforme alinhamento.',
        tempo: matchTempo ? matchTempo[1] : '01:00:00',
        classNivel1: matchC1 ? matchC1[1] : '',
        classNivel2: matchC2 ? matchC2[1] : ''
      };
    }

    return jsonResult;
  };
}
