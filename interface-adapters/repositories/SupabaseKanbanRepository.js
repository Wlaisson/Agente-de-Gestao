import fs from 'fs';
import path from 'path';
import { supabase } from '../../supabaseClient.js';

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
    tempo: item.tempo || ''
  };
}

export function createSupabaseKanbanRepository({ supabase }) {
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
    async listarCards() {
      try {
        const { data, error } = await supabase
          .from('kanban_cards')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && Array.isArray(data) && data.length > 0) {
          return data.map(linhaParaCard);
        }
      } catch (e) {
        console.error(e);
      }
      return carregarCardsLocais();
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
    }
  };
}

export const kanbanRepository = createSupabaseKanbanRepository({ supabase });
