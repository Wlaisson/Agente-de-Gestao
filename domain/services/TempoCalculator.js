// Aritmetica de tempo do backend.
//
// Por que existe separado de js/domain/tempo.js: aquele arquivo e servido ao
// navegador como parte do bundle estatico (`app.use(express.static('.'))`).
// Dominio dependendo da camada de UI inverte a direcao das dependencias da
// Clean Architecture, e o backend nao deve quebrar se o front for
// reempacotado. As conversoes HH:MM:SS <-> segundos sao as mesmas de la, de
// proposito - qualquer divergencia entre os dois seria bug.
//
// Este modulo carrega a garantia central do agente: TODO numero que o bot
// informa ("voce gastou 12h30 na RedePRO") sai daqui, nunca da soma de
// cabeca do modelo. O LLM decide O QUE somar; o codigo soma.

export function tempoParaSegundos(tempoStr) {
  if (!tempoStr) return 0;
  const partes = String(tempoStr).trim().split(':');
  if (partes.length < 2) return 0;
  const hrs = parseInt(partes[0], 10) || 0;
  const mins = parseInt(partes[1], 10) || 0;
  const secs = partes[2] ? parseInt(partes[2], 10) || 0 : 0;
  // Valores negativos nao existem no dominio (tempo gasto) e so poderiam vir
  // de dado corrompido - zerar e mais seguro que propagar para um total.
  if (hrs < 0 || mins < 0 || secs < 0) return 0;
  return (hrs * 3600) + (mins * 60) + secs;
}

export function segundosParaTempo(totalSegundos) {
  const t = Math.max(0, Math.floor(totalSegundos || 0));
  const hrs = Math.floor(t / 3600);
  const mins = Math.floor((t % 3600) / 60);
  const secs = t % 60;
  const pad = n => String(n).padStart(2, '0');
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

// Formato para humano ler numa frase ("12h30", "45min"). O HH:MM:SS cru soa
// robotico no meio de uma resposta de chat.
export function segundosParaTextoHumano(totalSegundos) {
  const t = Math.max(0, Math.floor(totalSegundos || 0));
  if (t === 0) return '0min';
  const hrs = Math.floor(t / 3600);
  const mins = Math.floor((t % 3600) / 60);
  if (hrs === 0) return `${mins}min`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h${String(mins).padStart(2, '0')}`;
}

export function segundosParaDecimal(totalSegundos) {
  return Number(((totalSegundos || 0) / 3600).toFixed(2));
}

// Soma + quebra por dimensao numa passada so. A quebra e o que permite o
// agente responder "12h30 no total, sendo 8h em Cadastro e 4h30 em
// Atendimento" sem uma segunda consulta ao banco.
export function somarTempoAtividades(atividades, { agruparPor = null } = {}) {
  const lista = Array.isArray(atividades) ? atividades : [];
  let totalSegundos = 0;
  const porChave = new Map();

  for (const atv of lista) {
    const segundos = tempoParaSegundos(atv?.tempo);
    totalSegundos += segundos;

    if (agruparPor) {
      const chaveBruta = atv?.[agruparPor];
      const chave = (chaveBruta === undefined || chaveBruta === null || chaveBruta === '')
        ? '(sem classificação)'
        : String(chaveBruta);
      const atual = porChave.get(chave) || { segundos: 0, quantidade: 0 };
      porChave.set(chave, { segundos: atual.segundos + segundos, quantidade: atual.quantidade + 1 });
    }
  }

  const quebra = [...porChave.entries()]
    .map(([chave, v]) => ({
      chave,
      quantidade: v.quantidade,
      totalSegundos: v.segundos,
      formatado: segundosParaTempo(v.segundos),
      humano: segundosParaTextoHumano(v.segundos)
    }))
    .sort((a, b) => b.totalSegundos - a.totalSegundos);

  return {
    quantidade: lista.length,
    totalSegundos,
    formatado: segundosParaTempo(totalSegundos),
    humano: segundosParaTextoHumano(totalSegundos),
    decimal: segundosParaDecimal(totalSegundos),
    quebra
  };
}
