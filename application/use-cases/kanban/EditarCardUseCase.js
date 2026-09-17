import { mapearEdicaoCard } from '../../../interface-adapters/mappers/KanbanPayloadMapper.js';
import { enviarParaWebhookLegado } from '../../../interface-adapters/gateways/GoogleSheetsWebhookGateway.js';

// Portado verbatim das acoes edit_kanban/update_kanban (tratadas como alias
// uma da outra no server.js original).
export function makeEditarCardUseCase({ kanbanRepository }) {
  return async function editarCard(body) {
    const { id } = body;
    const { camposCard, camposSupabase, webhookPayload } = mapearEdicaoCard(body);

    const cards = await kanbanRepository.listarCards();
    const card = cards.find(c => c.id === id);
    if (card) {
      Object.assign(card, camposCard);
      kanbanRepository.salvarCardsLocais(cards);
    }

    await kanbanRepository.atualizarSupabase(id, camposSupabase);

    enviarParaWebhookLegado({ ...webhookPayload, id });

    return card;
  };
}
