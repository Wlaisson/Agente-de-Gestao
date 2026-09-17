// Idioma comum aos ~6 pares abrirX/fecharX espalhados pelo app (mesmo padrao
// display:flex/none + classList 'active' repetido em cada modal).
export function abrirModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('active');
  }
  return modal;
}

export function fecharModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
}
