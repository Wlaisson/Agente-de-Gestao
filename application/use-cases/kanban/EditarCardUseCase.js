import { mapearEdicaoCard } from '../../../interface-adapters/mappers/KanbanPayloadMapper.js';
import { enviarParaWebhookLegado } from '../../../interface-adapters/gateways/GoogleSheetsWebhookGateway.js';
import { tentarGerarEmbedding } from '../../../shared/embeddingHelpers.js';

// Portado verbatim das acoes edit_kanban/update_kanban (tratadas como alias
// uma da outra no server.js original).
export function makeEditarCardUseCase({ kanbanRepository, openAIGateway, embeddingsGateway }) {
  return async function editarCard(body) {
    const { id } = body;
    const { camposCard, camposSupabase, webhookPayload } = mapearEdicaoCard(body);

    const cards = await kanbanRepository.listarCards();
    const card = cards.find(c => c.id === id);
    if (card) {
      Object.assign(card, camposCard);
      kanbanRepository.salvarCardsLocais(cards);
    }

    // So recalcula se titulo/descricao realmente mudaram (mesmo raciocinio
    // de AtualizarAtividadeUseCase). userId indisponivel aqui pelo mesmo gap
    // preexistente flagueado em AdicionarCardUseCase.js.
    if (camposCard.titulo !== undefined || camposCard.descricao !== undefined) {
      camposSupabase.embedding = await tentarGerarEmbedding({
        openAIGateway,
        embeddingsGateway,
        userId: undefined,
        texto: `${camposCard.titulo || ''}\n${camposCard.descricao || ''}`
      });
    }

    await kanbanRepository.atualizarSupabase(id, camposSupabase);

    enviarParaWebhookLegado({ ...webhookPayload, id });

    return card;
  };
}
