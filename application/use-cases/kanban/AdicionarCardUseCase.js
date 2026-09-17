import { mapearNovoCard, cardParaLinhaSupabase } from '../../../interface-adapters/mappers/KanbanPayloadMapper.js';
import { enviarParaWebhookLegado } from '../../../interface-adapters/gateways/GoogleSheetsWebhookGateway.js';

// Portado verbatim de action=add_kanban: escreve no arquivo local primeiro,
// depois tenta Supabase (best-effort, erro so logado), depois dispara o
// webhook legado (fire-and-forget) - mesma ordem e mesmo tratamento de erro
// de antes (nenhuma das 3 escritas e transacional entre si).
export function makeAdicionarCardUseCase({ kanbanRepository }) {
  return async function adicionarCard(body) {
    const cards = await kanbanRepository.listarCards();
    const novoCard = mapearNovoCard(body);

    cards.unshift(novoCard);
    kanbanRepository.salvarCardsLocais(cards);

    await kanbanRepository.upsertSupabase(cardParaLinhaSupabase(novoCard));

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
      status: novoCard.status
    });

    return novoCard;
  };
}
