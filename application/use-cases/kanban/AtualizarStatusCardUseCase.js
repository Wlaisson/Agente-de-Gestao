import { enviarParaWebhookLegado } from '../../../interface-adapters/gateways/GoogleSheetsWebhookGateway.js';

// Portado verbatim de action=update_kanban_status.
export function makeAtualizarStatusCardUseCase({ kanbanRepository }) {
  return async function atualizarStatusCard({ id, status }) {
    const cards = await kanbanRepository.listarCards();
    const card = cards.find(c => c.id === id);
    if (card) {
      card.status = status;
      kanbanRepository.salvarCardsLocais(cards);
    }

    await kanbanRepository.atualizarSupabase(id, {
      status,
      updated_at: new Date().toISOString()
    });

    enviarParaWebhookLegado({ action: 'update_kanban_status', id, status });
  };
}
