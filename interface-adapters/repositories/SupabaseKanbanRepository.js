import fs from 'fs';
import path from 'path';
import { supabase, supabaseAdmin } from '../../supabaseClient.js';

// NOTA (flag, nao corrigido nesta fase - ver plano de reorganizacao): usa o
// cliente Supabase ANONIMO (`supabase`), nao `supabaseAdmin` como todo o
// resto do backend - inconsistencia preexistente, preservada verbatim.
const KANBAN_FILE = path.join(process.cwd(), 'kanban_data.json');

function linhaParaCard(item) {
  return {
    id: item.id,
    titulo: item.titulo || '',
    descricao: item.descricao || '',
    projeto: item.projeto || '',
    assuntoInterno: item.assunto_interno || '',
    classNivel1: item.class_nivel_1 || '',
    classNivel2: item.class_nivel_2 || '',
    prioridade: item.prioridade || 'Média',
    status: item.status || 'A Fazer',
    dataCriacao: item.data_criacao || '',
    prazo: item.prazo || '',
    tempo: item.tempo || '',
    userId: item.user_id || null,
    // Cards gravados antes do escopo por usuario existir. Exposto (em vez de
    // escondido) porque o agente precisa poder dizer "esta tarefa nao tem
    // dono registrado" em vez de afirmar que e do usuario que perguntou.
    semDono: !item.user_id
  };
}

export function createSupabaseKanbanRepository({ supabase, supabaseAdmin }) {
  function carregarCardsLocais() {
    try {
      if (fs.existsSync(KANBAN_FILE)) {
        const data = fs.readFileSync(KANBAN_FILE, 'utf8');
        return JSON.parse(data);
      }
    } catch (e) {
      console.error(e);
    }
    return [];
  }

  function salvarCardsLocais(cards) {
    try {
      fs.writeFileSync(KANBAN_FILE, JSON.stringify(cards, null, 2), 'utf8');
    } catch (e) {
      console.error(e);
    }
  }

  return {
    // ESCOPO POR USUARIO (corrige a lacuna flagueada em schema-embeddings.sql:
    // `kanban_cards.user_id` nunca era preenchido e a listagem devolvia os
    // cards de TODOS os usuarios).
    //
    // Contrato preservado: chamada sem argumentos continua devolvendo tudo,
    // exatamente como antes - o front atual nao envia userId no Kanban e nao
    // pode quebrar. Quem passa `userId` (o agente sempre passa) recebe o
    // recorte do proprio usuario.
    //
    // `incluirSemDono` existe pela transicao: os cards ja gravados tem
    // user_id nulo e sumiriam da vista de todo mundo num filtro estrito, o
    // que seria pior que o problema. Eles vem marcados com `semDono: true`
    // ate o backfill (scripts/backfill_user_id_kanban.js) atribuir dono.
    async listarCards({ userId = null, incluirSemDono = true } = {}) {
      try {
        let query = supabase
          .from('kanban_cards')
          .select('*')
          .order('created_at', { ascending: false });

        if (userId) {
          query = incluirSemDono
            ? query.or(`user_id.eq.${userId},user_id.is.null`)
            : query.eq('user_id', userId);
        }

        const { data, error } = await query;

        if (!error && Array.isArray(data) && data.length > 0) {
          return data.map(linhaParaCard);
        }
      } catch (e) {
        console.error(e);
      }

      // O cache local em arquivo nao tem coluna de dono; filtramos em memoria
      // com a mesma regra para o fallback nao ser uma porta de escape do
      // escopo.
      const locais = carregarCardsLocais();
      if (!userId) return locais;
      return locais.filter(c => {
        const dono = c.userId || c.user_id || null;
        return dono === userId || (incluirSemDono && !dono);
      });
    },

    salvarCardsLocais,

    upsertSupabase(row) {
      return supabase.from('kanban_cards').upsert(row).then(() => {}).catch(e => console.error(e));
    },

    atualizarSupabase(id, row) {
      return supabase.from('kanban_cards').update(row).eq('id', id).then(() => {}).catch(e => console.error(e));
    },

    excluirSupabase(id) {
      return supabase.from('kanban_cards').delete().eq('id', id).then(() => {}).catch(e => console.error(e));
    },

    // Busca semantica via pgvector (schema-embeddings.sql). Usa supabaseAdmin
    // (nao o cliente anonimo `supabase` usado pelo resto deste repositorio)
    // porque chamadas RPC de leitura nao tem o mesmo motivo historico para
    // usar o cliente anonimo que as escritas tem - e mantem o mesmo cliente
    // usado pelo match_atividades equivalente, por consistencia.
    buscarSimilares(embeddingConsulta, { userId, limite = 5 } = {}) {
      return supabaseAdmin.rpc('match_kanban_cards', {
        query_embedding: embeddingConsulta,
        match_count: limite,
        match_user_id: userId || null
      });
    }
  };
}

export const kanbanRepository = createSupabaseKanbanRepository({ supabase, supabaseAdmin });
