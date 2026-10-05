// Cliente da fronteira REST do sistema de agentes.
//
// Usa /api/agentes/* (nao o /a2a): o interceptor de fetch ja injeta
// x-user-id e Authorization em toda chamada a /api/*, entao a identidade
// viaja sozinha - o front nunca manda userId no corpo.
export async function enviarMensagemAgente({ texto, taskId = null, contextId = null, dados = null }) {
  const res = await fetch('/api/agentes/conversar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto, taskId, contextId, dados })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Falha ao falar com o agente.');
  return json;
}

// Confirmacao/recusa de uma proposta de escrita. E o caminho estruturado -
// o backend reconhece { confirmar: true } sem precisar interpretar texto.
export async function confirmarAcaoAgente({ taskId, confirmar }) {
  const res = await fetch('/api/agentes/confirmar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, confirmar })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Falha ao confirmar a ação.');
  return json;
}

export async function listarAgentes() {
  const res = await fetch('/api/agentes');
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Falha ao listar agentes.');
  return json.agentes || [];
}

// Envia audio gravado ao agente. O servidor transcreve com Whisper e devolve
// a resposta do agente junto do texto transcrito — que a UI DEVE mostrar como
// bolha do usuario antes de qualquer acao.
export async function enviarAudioAgente({ blob, taskId = null, contextId = null }) {
  const form = new FormData();
  form.append('audio', blob, 'audio.webm');
  if (taskId) form.append('taskId', taskId);
  if (contextId) form.append('contextId', contextId);

  const res = await fetch('/api/agentes/conversar-audio', {
    method: 'POST',
    body: form
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Falha ao processar o áudio.');
  return json;
}

export async function obterHistoricoAgente(contextId) {
  const res = await fetch(`/api/agentes/historico/${encodeURIComponent(contextId)}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Falha ao obter histórico.');
  return json.mensagens || [];
}

