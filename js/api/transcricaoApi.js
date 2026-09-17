// Envio de audio (multipart/form-data) para as duas rotas de transcricao.
// Nao definir Content-Type manualmente - o navegador precisa gerar o
// boundary do multipart a partir do proprio objeto FormData.
export function transcreverParaAtividade(formData) {
  return fetch('/api/transcrever', { method: 'POST', body: formData });
}

export function transcreverParaKanban(formData) {
  return fetch('/api/transcrever-kanban', { method: 'POST', body: formData });
}
