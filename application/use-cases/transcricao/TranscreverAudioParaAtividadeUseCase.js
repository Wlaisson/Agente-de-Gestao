import { formatarListasParaPrompt } from './formatarListasParaPrompt.js';
import { parseLlmJson } from '../../../shared/parseLlmJson.js';
import { montarSystemPrompt } from '../../../shared/promptBuilder.js';
import { tentarGerarEmbedding, tentarBuscarContextoRag } from '../../../shared/embeddingHelpers.js';
import {
  TRANSCRICAO_ATIVIDADE_PERSONA,
  montarNegativasTranscricaoAtividade,
  TRANSCRICAO_ATIVIDADE_EXEMPLOS,
  montarSchemaJsonTranscricaoAtividade
} from './transcricaoAtividadePromptConfig.js';

function formatarContextoAtividadesSimilares(atividades) {
  if (!atividades || atividades.length === 0) return '';
  const linhas = atividades.map(a =>
    `- "${a.titulo || a.atividade}" (assunto: ${a.assunto_interno || 'N/A'}, projeto: ${a.projeto || 'N/A'})`
  );
  return 'Atividades semelhantes já registradas por este usuário (referência de vocabulário/padrão, não copie literalmente):\n' + linhas.join('\n');
}

// Transcreve o audio e extrai uma atividade estruturada. Reescrito para usar
// prompt-como-codigo (persona/negativas/exemplos/schema em
// transcricaoAtividadePromptConfig.js) + RAG via pgvector (busca atividades
// semelhantes do mesmo usuario para dar contexto de vocabulario/padrao) +
// CoT oculto (campo "raciocinio", nunca retornado - whitelist explicito).
export function makeTranscreverAudioParaAtividadeUseCase({ openAIGateway, embeddingsGateway, opcoesRepository, atividadeRepository }) {
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

    const contextoRag = await tentarBuscarContextoRag(async () => {
      const embeddingConsulta = await tentarGerarEmbedding({ openAIGateway, embeddingsGateway, userId, texto: textoCompleto });
      if (!embeddingConsulta) return '';
      const { data: atividadesSimilares } = await atividadeRepository.buscarSimilares(embeddingConsulta, { userId, limite: 5 });
      return formatarContextoAtividadesSimilares(atividadesSimilares);
    });

    const persona = `${TRANSCRICAO_ATIVIDADE_PERSONA}

Lista de Projetos Válidos:
${projetosStr}

Lista de Assuntos Internos Válidos:
${assuntosStr}

Lista de Combinações de Classificação (Nível 1 / Nível 2):
${classificacoesStr}`;

    const systemPrompt = montarSystemPrompt({
      persona,
      negativas: montarNegativasTranscricaoAtividade(),
      poucosExemplos: TRANSCRICAO_ATIVIDADE_EXEMPLOS,
      schemaJson: montarSchemaJsonTranscricaoAtividade(),
      contextoRag
    });

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
    let campos = resultado;

    if (!campos) {
      const matchTitulo = textoLimpo.match(/"titulo"\s*:\s*"([^"]+)"/i);
      const matchDesc = textoLimpo.match(/"descricao"\s*:\s*"([^"]+)"/i);
      const matchProj = textoLimpo.match(/"projeto_oficial"\s*:\s*"([^"]+)"/i);
      const matchAssunto = textoLimpo.match(/"assunto_interno"\s*:\s*"([^"]+)"/i);
      const matchTempo = textoLimpo.match(/"tempo"\s*:\s*"([^"]+)"/i);
      const matchC1 = textoLimpo.match(/"classNivel1"\s*:\s*"([^"]+)"/i);
      const matchC2 = textoLimpo.match(/"classNivel2"\s*:\s*"([^"]+)"/i);

      campos = {
        projeto_oficial: matchProj ? matchProj[1] : 'Interno',
        assunto_interno: matchAssunto ? matchAssunto[1] : '',
        titulo: matchTitulo ? matchTitulo[1] : 'Registro de Atividade',
        descricao: matchDesc ? matchDesc[1] : 'Atividade realizada conforme alinhamento.',
        tempo: matchTempo ? matchTempo[1] : '01:00:00',
        classNivel1: matchC1 ? matchC1[1] : '',
        classNivel2: matchC2 ? matchC2[1] : ''
      };
    }

    // Whitelist explicito: garante que "raciocinio" (exigido pelo CoT
    // oculto) jamais chegue ao frontend, preservando o contrato de resposta
    // exato de antes.
    return {
      projeto_oficial: campos.projeto_oficial ?? 'Interno',
      assunto_interno: campos.assunto_interno ?? '',
      titulo: campos.titulo ?? 'Registro de Atividade',
      descricao: campos.descricao ?? '',
      tempo: campos.tempo ?? '01:00:00',
      classNivel1: campos.classNivel1 ?? '',
      classNivel2: campos.classNivel2 ?? ''
    };
  };
}
