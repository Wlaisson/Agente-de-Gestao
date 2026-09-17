// mostrarToast existia duplicada (index.html tinha uma versao com icones via
// getAppSvgIcon; usuarios.html tinha uma versao mais simples sem icones e
// com timing de saida levemente diferente - 300ms vs 350ms). Uma fabrica so
// agora: cada pagina informa (opcionalmente) como resolver o icone, e o
// timing exato de cada uma e preservado via parametro, para nao mudar o
// comportamento visual de nenhuma das duas.
export function criarMostrarToast({ resolverIcone, duracaoSaidaMs = 350 } = {}) {
  return function mostrarToast(mensagem, tipo = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;

    if (resolverIcone) {
      const icon = resolverIcone(tipo);
      toast.innerHTML = `
                <span class="toast-icon">${icon}</span>
                <span class="toast-message">${mensagem}</span>
            `;
    } else {
      toast.innerHTML = `<span class="toast-message">${mensagem}</span>`;
    }

    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('visible');
    }, 50);
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => {
        toast.remove();
      }, duracaoSaidaMs);
    }, 3500);
  };
}
