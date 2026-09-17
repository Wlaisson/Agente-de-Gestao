import { enviarParaWebhookLegado } from '../../../interface-adapters/gateways/GoogleSheetsWebhookGateway.js';

// Portado verbatim de action=delete_kanban.
export function makeExcluirCardUseCase({ kanbanRepository }) {
  return async function excluirCard(id) {
    const cards = await kanbanRepository.listarCards();
    const restantes = cards.filter(c => c.id !== id);
    kanbanRepository.salvarCardsLocais(restantes);

    await kanbanRepository.excluirSupabase(id);

    enviarParaWebhookLegado({ action: 'delete_kanban', id });
  };
}
