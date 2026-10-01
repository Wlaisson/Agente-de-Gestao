import { enviarParaWebhookLegado } from '../../../interface-adapters/gateways/GoogleSheetsWebhookGateway.js';

// Portado de action=update_kanban_status.
//
// Defesa em profundidade: quando `userId` e fornecido (o agente e chamadas
// autenticadas enviam), revalida se o card pertence ao usuario antes de
// alterar o status. Se o card pertencer a outro usuario, a alteracao e
// rejeitada. Cards sem dono (legados, anteriores ao escopo) continuam
// permitidos ate a conclusao do backfill.
//
// Compatibilidade: quando `userId` nao e fornecido (chamadas do front atual
// do Kanban que ainda nao enviam identificacao), mantem o comportamento
// original sem bloquear.
export function makeAtualizarStatusCardUseCase({ kanbanRepository }) {
  return async function atualizarStatusCard({ id, status, userId = null }) {
    const cards = await kanbanRepository.listarCards();
    const card = cards.find(c => c.id === id);

    if (userId) {
      if (!card) {
        const erro = new Error(`Card "${id}" não encontrado.`);
        erro.status = 404;
        throw erro;
      }

      const donoDoCard = card.userId ?? card.user_id ?? null;
      if (donoDoCard && donoDoCard !== userId) {
        const erro = new Error('Não autorizado: este card pertence a outro usuário.');
        erro.status = 403;
        throw erro;
      }
    }

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

