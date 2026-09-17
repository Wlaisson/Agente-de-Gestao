import { enviarParaWebhookLegado } from '../../../interface-adapters/gateways/GoogleSheetsWebhookGateway.js';

// Portado verbatim de action=complete_kanban.
export function makeConcluirCardUseCase({ kanbanRepository }) {
  return async function concluirCard({ id, tempo, classNivel1, classNivel2 }) {
    const cards = await kanbanRepository.listarCards();
    const card = cards.find(c => c.id === id);
    if (card) {
      card.status = 'Concluído';
      if (classNivel1) card.classNivel1 = classNivel1;
      if (classNivel2) card.classNivel2 = classNivel2;
      if (tempo) card.tempo = tempo;
      kanbanRepository.salvarCardsLocais(cards);
    }

    const updateSupabase = {
      status: 'Concluído',
      updated_at: new Date().toISOString()
    };
    if (classNivel1) updateSupabase.class_nivel_1 = classNivel1;
    if (classNivel2) updateSupabase.class_nivel_2 = classNivel2;
    if (tempo) updateSupabase.tempo = tempo;

    await kanbanRepository.atualizarSupabase(id, updateSupabase);

    enviarParaWebhookLegado({
      action: 'complete_kanban',
      id,
      tempo,
      classNivel1,
      classNivel2
    });
  };
}
