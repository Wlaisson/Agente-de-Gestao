// Centraliza os 6 fetch('/api/kanban'...) que estavam duplicados inline em
// index.html. Assim como atividadesApi.js, devolve a Response crua - cada
// call site mantem seu proprio tratamento de erro/fallback para o webhook
// legado (fetch(WEBHOOK_URL,...) direto no catch), que nao faz parte desta
// API (fica no proprio index.html por enquanto).
export function listarCards() {
  return fetch('/api/kanban');
}

function enviarAcao(payload) {
  return fetch('/api/kanban', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export function atualizarStatus(id, status) {
  return enviarAcao({ action: 'update_kanban_status', id, status });
}

export function excluirCard(id) {
  return enviarAcao({ action: 'delete_kanban', id });
}

export function concluirCard({ id, tempo, classNivel1, classNivel2 }) {
  return enviarAcao({ action: 'complete_kanban', id, tempo, classNivel1, classNivel2 });
}

// add_kanban/edit_kanban: o payload montado no call site ja inclui `action`
// (mantido assim para nao duplicar a lista de campos aqui e la).
export function adicionarCard(payload) {
  return enviarAcao(payload);
}

export function editarCard(payload) {
  return enviarAcao(payload);
}
