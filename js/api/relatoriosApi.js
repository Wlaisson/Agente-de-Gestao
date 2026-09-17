function postRelatorio(url, { semana, userId }) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId || ''
    },
    body: JSON.stringify({ semana, userId: userId || '' })
  });
}

export function gerarRelatorioSemanal({ semana, userId }) {
  return postRelatorio('/api/gerar-relatorio', { semana, userId });
}

export function gerarRelatorioReporter({ semana, userId }) {
  return postRelatorio('/api/gerar-relatorio-reporter', { semana, userId });
}
