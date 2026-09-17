import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '../../supabaseClient.js';
import { OPCOES_DEFAULT } from '../../domain/entities/Opcoes.js';

const OPCOES_FILE = path.join(process.cwd(), 'opcoes_sistema.json');

// Dual-write Supabase + arquivo JSON local, portado verbatim de
// carregarOpcoes/salvarOpcoes em server.js (mesma ordem de fallback:
// Supabase -> arquivo local -> seed com OPCOES_DEFAULT).
export function createSupabaseOpcoesRepository({ supabaseAdmin }) {
  return {
    async carregar() {
      try {
        const { data, error } = await supabaseAdmin
          .from('opcoes_sistema')
          .select('dados')
          .eq('id', 'padrao')
          .single();
        if (!error && data && data.dados) {
          return data.dados;
        }
      } catch (e) {
        console.error(e);
      }

      try {
        if (fs.existsSync(OPCOES_FILE)) {
          const data = fs.readFileSync(OPCOES_FILE, 'utf8');
          const parsed = JSON.parse(data);
          if (parsed && Array.isArray(parsed.assuntosInternos) && Array.isArray(parsed.projetos) && parsed.classificacoes) {
            return parsed;
          }
        }
      } catch (e) {
        console.error(e);
      }

      await this.salvar(OPCOES_DEFAULT);
      return OPCOES_DEFAULT;
    },

    async salvar(opcoes) {
      try {
        await supabaseAdmin
          .from('opcoes_sistema')
          .upsert({ id: 'padrao', dados: opcoes, updated_at: new Date().toISOString() });
      } catch (e) {
        console.error(e);
      }

      try {
        fs.writeFileSync(OPCOES_FILE, JSON.stringify(opcoes, null, 2), 'utf8');
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    }
  };
}

// Instancia padrao para consumidores ainda nao migrados (ex.: rotas de
// transcricao em legacyRoutes.js, que so leem opcoes para montar o prompt).
export const opcoesRepository = createSupabaseOpcoesRepository({ supabaseAdmin });
