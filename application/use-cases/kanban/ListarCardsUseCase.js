// Repassa o escopo por usuario para o repositorio. Chamada sem argumentos
// continua devolvendo todos os cards (contrato preservado para o front
// atual, que ainda nao envia userId no Kanban); o agente sempre passa
// `userId` e por isso nunca enxerga tarefa de outra pessoa.
export function makeListarCardsUseCase({ kanbanRepository }) {
  return function listarCards({ userId = null, incluirSemDono = true } = {}) {
    return kanbanRepository.listarCards({ userId, incluirSemDono });
  };
}
