// Centraliza os 6 fetch('/api/atividades'...) que estavam duplicados inline
// em index.html. Retorna a Response crua (nao o JSON ja parseado) porque
// cada call site tinha sua propria logica de checar res.ok e decidir se/como
// ler o body - preservar isso evita mudar o tratamento de erro de cada um.
// Os headers manuais de x-user-id que existiam em cada chamada foram
// removidos: o interceptor global (js/api/httpClient.js) ja injeta o mesmo
// header a partir do usuario logado em toda chamada a /api/*, entao eram
// redundantes (mesmo valor, calculado da mesma forma).
export function listarAtividades(queryString = '') {
  return fetch(`/api/atividades${queryString}`);
}

export function criarAtividade(payload) {
  return fetch('/api/atividades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function atualizarAtividade(id, payload) {
  return fetch(`/api/atividades/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function excluirAtividade(id) {
  return fetch(`/api/atividades/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
