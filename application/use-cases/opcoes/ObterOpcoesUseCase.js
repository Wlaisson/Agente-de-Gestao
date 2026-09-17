export function makeObterOpcoesUseCase({ opcoesRepository }) {
  return function obterOpcoes() {
    return opcoesRepository.carregar();
  };
}
