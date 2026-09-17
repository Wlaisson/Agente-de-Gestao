export function makeListarCardsUseCase({ kanbanRepository }) {
  return function listarCards() {
    return kanbanRepository.listarCards();
  };
}
