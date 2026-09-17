import OpenAI, { toFile } from 'openai';
import { supabaseAdmin } from '../../supabaseClient.js';
import { openaiGlobal, MODELOS } from '../../infrastructure/openai/openaiClient.js';

// obterClienteOpenAI + chamarModelo/chamarModeloComFallback, portados
// verbatim de server.js.
//
// NOTA (flag, nao corrigido nesta fase - ver plano de reorganizacao):
// obterCliente tem um 3o nivel de fallback que busca QUALQUER linha em
// setup_usuario com uma chave nao-nula (sem filtrar por userId) - ou seja,
// na ausencia de chave global e de chave propria do usuario, a requisicao
// pode usar a chave (e o custo) da OpenAI de outro usuario qualquer.
export function createOpenAIGateway({ supabaseAdmin, openaiGlobal, modelosPadrao }) {
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

    try {
      const { data, error } = await supabaseAdmin
        .from('setup_usuario')
        .select('openai_api_key, openai_model')
        .not('openai_api_key', 'is', null)
        .limit(1);

      if (!error && data && data.length > 0 && data[0].openai_api_key) {
        return {
          openai: new OpenAI({ apiKey: data[0].openai_api_key }),
          modelos: [data[0].openai_model || 'gpt-4o-mini', 'gpt-4o-mini']
        };
      }
    } catch (e) {
      console.error(e);
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
        return await openaiInstance.chat.completions.create(payload);
      } catch (err) {
        ultimoErro = err;
        console.log(`[MODELO] Falha com ${modelo}: ${err.status || err.message}`);
      }
    }
    throw ultimoErro;
  }

  async function transcreverAudio({ openai, buffer, filename, mimetype }) {
    const audioFile = await toFile(buffer, filename || 'audio.webm', { type: mimetype || 'audio/webm' });
    return openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'pt',
      response_format: 'json'
    });
  }

  return { obterCliente, chamarModelo, transcreverAudio };
}

// Instancia padrao para consumidores ainda nao migrados (relatorios/reuniao,
// que continuam em legacyRoutes.js ate suas proprias fases).
export const openAIGateway = createOpenAIGateway({ supabaseAdmin, openaiGlobal, modelosPadrao: MODELOS });
