import { enviarMensagemAgente, confirmarAcaoAgente, enviarAudioAgente } from '../api/agentesApi.js';

// Aba "Assistente": o chat com o sistema de agentes.
//
// Duas decisoes de interface que sustentam as garantias do backend:
//
// 1. PROPOSTA NAO E MENSAGEM. Quando o agente propoe uma escrita, a UI
//    renderiza um cartao com os campos e dois botoes. Deixar o usuario
//    responder "sim" digitando funciona, mas o botao manda
//    { confirmar: true } estruturado - o unico caminho que o backend aceita
//    sem interpretar linguagem natural.
//
// 2. O TEXTO DO SLIDE E PARA COPIAR, NAO PARA LER. Toda resposta do agente
//    ganha um botao de copiar; e o proposito da aba (tirar o copia-e-cola
//    manual do meio do caminho).

// Markdown mínimo. Deliberadamente pequeno e com escape ANTES de qualquer
// substituicao: o texto vem de um LLM, que pode ecoar conteudo do banco -
// injetar isso como HTML cru seria XSS com passo extra.
function escaparHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderizarMarkdown(texto) {
  const escapado = escaparHtml(texto);
  const linhas = escapado.split('\n');
  const html = [];
  let emLista = false;
  let emTabela = false;

  const fecharBlocos = () => {
    if (emLista) { html.push('</ul>'); emLista = false; }
    if (emTabela) { html.push('</tbody></table>'); emTabela = false; }
  };

  const inline = (t) => t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s.,;:)]|$)/g, '$1<em>$2</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

  for (const linha of linhas) {
    const t = linha.trim();

    if (!t) { fecharBlocos(); continue; }

    // Separador entre o conteúdo do slide e as observações do agente.
    if (/^---+$/.test(t)) { fecharBlocos(); html.push('<hr class="assistente-sep">'); continue; }

    // Linha de tabela Markdown.
    if (t.startsWith('|') && t.endsWith('|')) {
      const celulas = t.slice(1, -1).split('|').map(c => c.trim());
      // Linha separadora (|---|---|) só delimita o cabeçalho.
      if (celulas.every(c => /^:?-+:?$/.test(c))) continue;
      if (!emTabela) {
        fecharBlocos();
        html.push('<table class="assistente-tabela"><tbody>');
        emTabela = true;
      }
      html.push('<tr>' + celulas.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>');
      continue;
    }
    if (emTabela) { html.push('</tbody></table>'); emTabela = false; }

    const itemLista = t.match(/^[-*]\s+(.*)$/);
    if (itemLista) {
      if (!emLista) { html.push('<ul class="assistente-lista">'); emLista = true; }
      html.push(`<li>${inline(itemLista[1])}</li>`);
      continue;
    }
    if (emLista) { html.push('</ul>'); emLista = false; }

    html.push(`<p>${inline(t)}</p>`);
  }

  fecharBlocos();
  return html.join('');
}

const SUGESTOES = [
  'Quanto tempo eu gastei essa semana em cada projeto?',
  'Gera o texto do weekly da Imdepa dessa semana',
  'Monta o slide de Agentes de Catálogo da AI Estratégica',
  'O que está atrasado no meu Kanban?'
];

export function createAssistenteFeature({ mostrarToast }) {
  // Estado da conversa. `contextId` amarra as tarefas de um mesmo fio;
  // `taskIdPendente` guarda a tarefa parada em input-required, que e a que
  // os botoes de confirmacao respondem.
  let contextId = null;
  let taskIdPendente = null;
  let enviando = false;

  // Estado de gravacao de audio, mesmo padrao das outras abas.
  let mediaRecorder = null;
  let audioChunks = [];
  let gravando = false;

  const el = (id) => document.getElementById(id);

  function rolarParaFim() {
    const hist = el('assistente-historico');
    if (hist) hist.scrollTop = hist.scrollHeight;
  }

  function adicionarBolha({ papel, html, comCopia = false, textoCru = '' }) {
    const hist = el('assistente-historico');
    if (!hist) return null;

    const vazio = el('assistente-vazio');
    if (vazio) vazio.style.display = 'none';

    const wrapper = document.createElement('div');
    wrapper.className = `assistente-msg assistente-msg-${papel}`;

    const bolha = document.createElement('div');
    bolha.className = 'assistente-bolha';
    bolha.innerHTML = html;
    wrapper.appendChild(bolha);

    if (comCopia && textoCru) {
      const acoes = document.createElement('div');
      acoes.className = 'assistente-acoes-msg';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'assistente-btn-copiar';
      btn.textContent = 'Copiar';
      btn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(textoCru);
          btn.textContent = 'Copiado';
          setTimeout(() => { btn.textContent = 'Copiar'; }, 1800);
        } catch (e) {
          mostrarToast('Não consegui copiar automaticamente.', 'error');
        }
      };
      acoes.appendChild(btn);
      wrapper.appendChild(acoes);
    }

    hist.appendChild(wrapper);
    rolarParaFim();
    return wrapper;
  }

  function mostrarPensando() {
    const hist = el('assistente-historico');
    if (!hist) return null;
    const div = document.createElement('div');
    div.className = 'assistente-msg assistente-msg-agente';
    div.id = 'assistente-pensando';
    div.innerHTML = '<div class="assistente-bolha assistente-pensando"><span></span><span></span><span></span></div>';
    hist.appendChild(div);
    rolarParaFim();
    return div;
  }

  function removerPensando() {
    const p = el('assistente-pensando');
    if (p) p.remove();
  }

  // Cartao de proposta: mostra exatamente o que sera gravado, campo a campo,
  // com os avisos que a ferramenta devolveu. O usuario aprova o que ve.
  function renderizarPropostas(propostas, taskId) {
    const hist = el('assistente-historico');
    if (!hist) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'assistente-msg assistente-msg-agente';
    wrapper.id = `assistente-proposta-${taskId}`;

    const cartao = document.createElement('div');
    cartao.className = 'assistente-proposta';

    const titulo = document.createElement('div');
    titulo.className = 'assistente-proposta-titulo';
    titulo.textContent = propostas.length > 1
      ? `${propostas.length} alterações aguardando sua confirmação`
      : 'Alteração aguardando sua confirmação';
    cartao.appendChild(titulo);

    for (const proposta of propostas) {
      const item = document.createElement('div');
      item.className = 'assistente-proposta-item';

      const desc = document.createElement('div');
      desc.className = 'assistente-proposta-desc';
      desc.textContent = proposta.descricao || proposta.tipo;
      item.appendChild(desc);

      const campos = document.createElement('dl');
      campos.className = 'assistente-proposta-campos';
      for (const [chave, valor] of Object.entries(proposta.dados || {})) {
        if (chave === 'avisos' || valor === '' || valor === null || valor === undefined) continue;
        const dt = document.createElement('dt');
        dt.textContent = chave;
        const dd = document.createElement('dd');
        dd.textContent = String(valor);
        campos.appendChild(dt);
        campos.appendChild(dd);
      }
      item.appendChild(campos);

      // Avisos sao o que o usuario precisa ver ANTES de aprovar (campo
      // faltando, tempo nao reconhecido, projeto fora do cadastro).
      const avisos = proposta.dados?.avisos || [];
      if (avisos.length) {
        const ul = document.createElement('ul');
        ul.className = 'assistente-proposta-avisos';
        for (const aviso of avisos) {
          const li = document.createElement('li');
          li.textContent = aviso;
          ul.appendChild(li);
        }
        item.appendChild(ul);
      }

      cartao.appendChild(item);
    }

    const acoes = document.createElement('div');
    acoes.className = 'assistente-proposta-acoes';

    const btnConfirmar = document.createElement('button');
    btnConfirmar.type = 'button';
    btnConfirmar.className = 'btn btn-primary';
    btnConfirmar.textContent = 'Confirmar e salvar';
    btnConfirmar.onclick = () => responderProposta(taskId, true, cartao);

    const btnCancelar = document.createElement('button');
    btnCancelar.type = 'button';
    btnCancelar.className = 'btn btn-secondary';
    btnCancelar.textContent = 'Descartar';
    btnCancelar.onclick = () => responderProposta(taskId, false, cartao);

    acoes.appendChild(btnConfirmar);
    acoes.appendChild(btnCancelar);
    cartao.appendChild(acoes);

    wrapper.appendChild(cartao);
    hist.appendChild(wrapper);
    rolarParaFim();
  }

  async function responderProposta(taskId, confirmar, cartao) {
    // Desabilita os dois botoes de imediato: um duplo-clique reenviaria a
    // confirmacao e, no pior caso, gravaria duas vezes.
    cartao.querySelectorAll('button').forEach(b => { b.disabled = true; });
    const pensando = mostrarPensando();

    try {
      const resposta = await confirmarAcaoAgente({ taskId, confirmar });
      removerPensando();
      cartao.classList.add(confirmar ? 'assistente-proposta-aceita' : 'assistente-proposta-descartada');
      taskIdPendente = null;

      if (resposta.texto) {
        adicionarBolha({ papel: 'agente', html: renderizarMarkdown(resposta.texto), textoCru: resposta.texto });
      }
      if (confirmar) mostrarToast('Alteração aplicada.', 'success');
    } catch (e) {
      removerPensando();
      cartao.querySelectorAll('button').forEach(b => { b.disabled = false; });
      mostrarToast(e.message, 'error');
    } finally {
      if (pensando) removerPensando();
    }
  }

  async function enviarMensagem(textoForcado = null) {
    if (enviando) return;

    const input = el('assistente-input');
    const texto = (textoForcado ?? input?.value ?? '').trim();
    if (!texto) return;

    enviando = true;
    if (input && !textoForcado) input.value = '';
    if (input) input.style.height = 'auto';
    const btn = el('assistente-enviar');
    if (btn) btn.disabled = true;

    adicionarBolha({ papel: 'usuario', html: renderizarMarkdown(texto) });
    mostrarPensando();

    try {
      const resposta = await enviarMensagemAgente({
        texto,
        // Uma tarefa parada em input-required continua sendo a tarefa ativa:
        // mandar o taskId permite responder a proposta por texto livre
        // ("sim, mas troca o projeto") em vez de so pelos botoes.
        taskId: taskIdPendente,
        contextId
      });

      removerPensando();
      contextId = resposta.contextId || contextId;

      if (resposta.texto) {
        adicionarBolha({
          papel: 'agente',
          html: renderizarMarkdown(resposta.texto),
          comCopia: true,
          textoCru: resposta.texto
        });
      }

      if (resposta.aguardandoConfirmacao && resposta.propostas?.length) {
        taskIdPendente = resposta.taskId;
        renderizarPropostas(resposta.propostas, resposta.taskId);
      } else {
        taskIdPendente = null;
      }
    } catch (e) {
      removerPensando();
      adicionarBolha({
        papel: 'agente',
        html: `<p class="assistente-erro">${escaparHtml(e.message)}</p>`
      });
    } finally {
      enviando = false;
      if (btn) btn.disabled = false;
      if (input && !textoForcado) input.focus();
    }
  }

  function novaConversa() {
    contextId = null;
    taskIdPendente = null;
    const hist = el('assistente-historico');
    if (hist) hist.innerHTML = '';
    const vazio = el('assistente-vazio');
    if (vazio) vazio.style.display = '';
    montarSugestoes();
  }

  function montarSugestoes() {
    const container = el('assistente-sugestoes');
    if (!container) return;
    container.innerHTML = '';
    for (const sugestao of SUGESTOES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'assistente-sugestao';
      btn.textContent = sugestao;
      btn.onclick = () => enviarMensagem(sugestao);
      container.appendChild(btn);
    }
  }

  function inicializar() {
    montarSugestoes();
    const input = el('assistente-input');
    if (input && !input.dataset.ligado) {
      input.dataset.ligado = '1';
      input.addEventListener('keydown', (ev) => {
        // Enter envia; Shift+Enter quebra linha - um relato de atividade
        // costuma ter mais de uma linha.
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          enviarMensagem();
        }
      });
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 160) + 'px';
      });
    }

    // Botao de microfone: reaproveitando o padrao de gravacao das outras abas.
    const btnMic = el('assistente-mic');
    if (btnMic && !btnMic.dataset.ligado) {
      btnMic.dataset.ligado = '1';
      btnMic.addEventListener('click', () => {
        if (!gravando) {
          iniciarGravacao();
        } else {
          pararGravacao();
        }
      });
    }
  }

  // --- Gravação de áudio ---------------------------------------------------

  async function iniciarGravacao() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        // Liberar o microfone imediatamente.
        stream.getTracks().forEach(t => t.stop());

        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        await enviarAudio(audioBlob);
      };

      mediaRecorder.start();
      gravando = true;
      const btnMic = el('assistente-mic');
      if (btnMic) btnMic.classList.add('gravando');
    } catch (e) {
      mostrarToast('Não foi possível acessar o microfone.', 'error');
    }
  }

  function pararGravacao() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    gravando = false;
    const btnMic = el('assistente-mic');
    if (btnMic) btnMic.classList.remove('gravando');
  }

  async function enviarAudio(blob) {
    if (enviando) return;
    enviando = true;

    const btn = el('assistente-enviar');
    if (btn) btn.disabled = true;

    mostrarPensando();

    try {
      const resposta = await enviarAudioAgente({
        blob,
        taskId: taskIdPendente,
        contextId
      });

      removerPensando();
      contextId = resposta.contextId || contextId;

      // Regra de seguranca 1: o texto transcrito SEMPRE aparece como bolha
      // do usuario, ANTES da resposta do agente. Sem isso, o usuario nao
      // tem como perceber que foi entendido errado.
      if (resposta.textoTranscrito) {
        adicionarBolha({ papel: 'usuario', html: renderizarMarkdown(resposta.textoTranscrito) });
      }

      if (resposta.texto) {
        adicionarBolha({
          papel: 'agente',
          html: renderizarMarkdown(resposta.texto),
          comCopia: true,
          textoCru: resposta.texto
        });
      }

      // Regra de seguranca 2: voz nunca reduz o nivel de confirmacao.
      // Proposta de escrita vinda de audio continua exigindo o cartao visual.
      if (resposta.aguardandoConfirmacao && resposta.propostas?.length) {
        taskIdPendente = resposta.taskId;
        renderizarPropostas(resposta.propostas, resposta.taskId);
      } else {
        taskIdPendente = null;
      }
    } catch (e) {
      removerPensando();
      adicionarBolha({
        papel: 'agente',
        html: `<p class="assistente-erro">${escaparHtml(e.message)}</p>`
      });
    } finally {
      enviando = false;
      if (btn) btn.disabled = false;
    }
  }

  return { inicializar, enviarMensagem, novaConversa };
}
