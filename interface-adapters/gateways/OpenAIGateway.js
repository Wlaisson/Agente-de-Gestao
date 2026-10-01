import OpenAI, { toFile } from 'openai';
import { supabaseAdmin } from '../../supabaseClient.js';
import { openaiGlobal, MODELOS } from '../../infrastructure/openai/openaiClient.js';

// obterClienteOpenAI + chamarModelo/chamarModeloComFallback, portados
// verbatim de server.js.
//
// CORRIGIDO (era flag conhecida): o 3o nivel de fallback busca QUALQUER
// linha em setup_usuario com uma chave nao-nula, sem filtrar por userId - ou
// seja, na ausencia de chave global e de chave propria, a requisicao usava a
// chave (e o custo) da OpenAI de outro usuario qualquer.
//
// Com atividade pontual isso ja era indevido; com o agente conversacional
// (varias chamadas de modelo por pergunta, mais as chamadas de delegacao
// entre agentes) vira custo recorrente cobrado de terceiro. O fallback passa
// a ser opt-in por env var, desligado por padrao: quem dependia dele em
// algum ambiente restaura definindo PERMITIR_CHAVE_OPENAI_COMPARTILHADA=true,
// de forma explicita e auditavel.
export function createOpenAIGateway({
  supabaseAdmin,
  openaiGlobal,
  modelosPadrao,
  permitirChaveCompartilhada = process.env.PERMITIR_CHAVE_OPENAI_COMPARTILHADA === 'true'
}) {
  async function obterCliente(userId) {
    if (userId) {
      try {
        const { data, error } = await supabaseAdmin
          .from('setup_usuario')
          .select('openai_api_key, openai_model')
          .eq('user_id', userId)
          .single();

        if (!error && data && data.openai_api_key) {
          return {
            openai: new OpenAI({ apiKey: data.openai_api_key }),
            modelos: [data.openai_model || 'gpt-4o-mini', 'gpt-4o-mini']
          };
        }
      } catch (e) {
        console.error(e);
      }
    }

    if (openaiGlobal) {
      return { openai: openaiGlobal, modelos: modelosPadrao };
    }

    if (permitirChaveCompartilhada) {
      try {
        const { data, error } = await supabaseAdmin
          .from('setup_usuario')
          .select('openai_api_key, openai_model')
          .not('openai_api_key', 'is', null)
          .limit(1);

        if (!error && data && data.length > 0 && data[0].openai_api_key) {
          console.warn(
            '[OpenAIGateway] Usando chave OpenAI de OUTRO usuario (fallback compartilhado ' +
            'habilitado por PERMITIR_CHAVE_OPENAI_COMPARTILHADA). O custo desta chamada sera ' +
            'cobrado na conta desse terceiro.'
          );
          return {
            openai: new OpenAI({ apiKey: data[0].openai_api_key }),
            modelos: [data[0].openai_model || 'gpt-4o-mini', 'gpt-4o-mini']
          };
        }
      } catch (e) {
        console.error(e);
      }
    }

    throw new Error('Setup incompleto: Chave da OpenAI não configurada');
  }

  async function chamarModelo(params, clientOverride, modelosOverride) {
    const openaiInstance = clientOverride || openaiGlobal;
    if (!openaiInstance) {
      throw new Error('Setup incompleto: Chave da OpenAI não configurada');
    }
    const listaModelos = modelosOverride && modelosOverride.length > 0 ? modelosOverride : modelosPadrao;
    let ultimoErro;
    for (const modelo of listaModelos) {
      try {
        const payload = { ...params, model: modelo };
        if (payload.max_tokens && !payload.max_completion_tokens) {
          payload.max_completion_tokens = payload.max_tokens;
          delete payload.max_tokens;
        }
        if (modelo.startsWith('gpt-5') || modelo.startsWith('o1') || modelo.startsWith('o3') || modelo.startsWith('o4')) {
          delete payload.temperature;
        }
        // Os prompts ja pedem o raciocinio no campo "raciocinio" do JSON - o
        // raciocinio interno do modelo e redundante e, com prompts maiores,
        // consumia todo o max_completion_tokens (finish_reason "length",
        // content vazio). 'minimal' so existe na familia gpt-5 original.
        if (/^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/.test(modelo) && !payload.reasoning_effort) {
          payload.reasoning_effort = 'minimal';
        }
        const resposta = await openaiInstance.chat.completions.create(payload);
        const escolha = resposta.choices && resposta.choices[0];
        // Resposta vazia (ex.: tokens esgotados no raciocinio) conta como
        // falha para cair no proximo modelo, em vez de seguir para o
        // fallback generico do use-case.
        //
        // Excecao: em tool calling, `content: null` com `tool_calls`
        // preenchido e a resposta CORRETA - o modelo pediu uma ferramenta em
        // vez de escrever texto. Sem esta ressalva o gateway rejeitava toda
        // chamada de ferramenta como vazia e o sistema de agentes nunca
        // conseguia executar nada.
        const temTexto = !!escolha?.message?.content;
        const temChamadaDeFerramenta = Array.isArray(escolha?.message?.tool_calls)
          && escolha.message.tool_calls.length > 0;
        if (!escolha || !escolha.message || (!temTexto && !temChamadaDeFerramenta)) {
          throw new Error(`resposta vazia (finish_reason: ${escolha ? escolha.finish_reason : 'n/a'})`);
        }
        return resposta;
      } catch (err) {
        ultimoErro = err;
        console.log(`[MODELO] Falha com ${modelo}: ${err.status || err.message}`);
      }
    }
    throw ultimoErro;
  }

  // `prompt` (opcional): vocabulario de dominio que orienta a grafia de nomes
  // proprios na transcricao - ver shared/vocabularioTranscricao.js.
  async function transcreverAudio({ openai, buffer, filename, mimetype, prompt }) {
    const audioFile = await toFile(buffer, filename || 'audio.webm', { type: mimetype || 'audio/webm' });
    return openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'pt',
      response_format: 'json',
      ...(prompt ? { prompt } : {})
    });
  }

  return { obterCliente, chamarModelo, transcreverAudio };
}

// Instancia padrao, exportada para scripts e para quem precisa do gateway
// fora do composition root (ver scripts/backfill_embeddings_atividades.js).
// As rotas montam a propria instancia em interface-adapters/routes/index.js.
export const openAIGateway = createOpenAIGateway({ supabaseAdmin, openaiGlobal, modelosPadrao: MODELOS });
