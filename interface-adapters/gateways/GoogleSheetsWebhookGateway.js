import { WEBHOOK_URL } from '../../config/env.js';

// O padrao "fetch(WEBHOOK_URL, {POST, JSON}).catch(log)" (fire-and-forget,
// erro so logado, nunca falha a requisicao principal) estava repetido ~8x
// em server.js. Uma so funcao agora, mesmo comportamento (inclusive o fato
// de nao ter await no chamador - a promise roda em segundo plano).
export function enviarParaWebhookLegado(payload) {
  return fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(err => console.error(err));
}
