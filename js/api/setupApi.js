export function obterSetupUsuario(userId) {
  return fetch(`/api/setup/${userId}`);
}

export function salvarSetupUsuario(payload) {
  return fetch('/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
