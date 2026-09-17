export function processarReuniao(payload) {
  return fetch('/api/processar-reuniao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
