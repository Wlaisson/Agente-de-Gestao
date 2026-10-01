import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '../../supabaseClient.js';
import { OPCOES_DEFAULT, isOpcoesValido } from '../../domain/entities/Opcoes.js';

const OPCOES_FILE = path.join(process.cwd(), 'opcoes_sistema.json');

// Codigo do PostgREST para ".single() nao encontrou nenhuma linha".
const SEM_LINHAS = 'PGRST116';

function lerArquivoLocal() {
  try {
    if (fs.existsSync(OPCOES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(OPCOES_FILE, 'utf8'));
      if (isOpcoesValido(parsed)) return parsed;
    }
  } catch (e) {
    console.error(e);
  }
  return null;
}

// Dual-write Supabase + arquivo JSON local.
//
// IMPORTANTE: o seed com OPCOES_DEFAULT so acontece quando o Supabase confirma
// que a linha 'padrao' NAO existe. Antes, qualquer falha transitoria na leitura
// (timeout, cold start, rede) caia no seed e sobrescrevia no banco todos os
// assuntos/projetos/classificacoes cadastrados - na Vercel o arquivo local
// nunca existe, entao nao havia nada entre o erro e o reset.
export function createSupabaseOpcoesRepository({ supabaseAdmin }) {
  return {
    async carregar() {
      let resultado;
      try {
        resultado = await supabaseAdmin
          .from('opcoes_sistema')
          .select('dados')
          .eq('id', 'padrao')
          .single();
      } catch (e) {
        resultado = { data: null, error: e };
      }
      const { data, error } = resultado || {};

      if (!error && data && isOpcoesValido(data.dados)) {
        return data.dados;
      }

      const linhaInexistente = (!error && !data) || (error && error.code === SEM_LINHAS);
      if (!linhaInexistente) {
        // Erro de leitura (ou dado corrompido): usa o arquivo local se houver
        // (ambiente de dev), mas NUNCA grava defaults por cima do banco.
        console.error('Falha ao carregar opcoes_sistema:', error || 'dados invalidos');
        const local = lerArquivoLocal();
        if (local) return local;
        const erro = new Error('Nao foi possivel carregar as opcoes do sistema. Tente novamente.');
        erro.status = 503;
        throw erro;
      }

      const local = lerArquivoLocal();
      // Clona para que mutacoes do use-case nao alterem a constante do modulo.
      const seed = local || structuredClone(OPCOES_DEFAULT);
      await this.salvar(seed);
      return seed;
    },

    async salvar(opcoes) {
      if (!isOpcoesValido(opcoes)) {
        const erro = new Error('Dados invÃ¡lidos');
        erro.status = 400;
        throw erro;
      }

      const { error } = (await supabaseAdmin
        .from('opcoes_sistema')
        .upsert({ id: 'padrao', dados: opcoes, updated_at: new Date().toISOString() })) || {};
      if (error) {
        console.error('Falha ao salvar opcoes_sistema:', error);
        const erro = new Error('Nao foi possivel salvar as opcoes do sistema.');
        erro.status = 503;
        throw erro;
      }

      try {
        fs.writeFileSync(OPCOES_FILE, JSON.stringify(opcoes, null, 2), 'utf8');
      } catch (e) {
        // Esperado na Vercel (filesystem somente leitura) - o Supabase e a fonte.
      }
      return true;
    }
  };
}

// Instancia padrao, exportada para uso fora do composition root. As rotas
// montam a propria instancia em interface-adapters/routes/index.js.
export const opcoesRepository = createSupabaseOpcoesRepository({ supabaseAdmin });
