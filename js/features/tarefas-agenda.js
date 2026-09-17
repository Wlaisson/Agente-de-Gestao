import * as reuniaoApi from '../api/reuniaoApi.js';

// Feature isolada deliberadamente: fala com um backend LEGADO separado (o
// webhook do Google Apps Script, via GET com query params action=list_tasks/
// sync_calendar/update_task_status), nao com o /api/* do Supabase que o
// resto do app usa. Essa e uma peculiaridade arquitetural real do sistema,
// nao um detalhe de implementacao - isolar esta feature em seu proprio
// modulo deixa essa peculiaridade visivel em vez de enterrada no meio do
// script principal.
//
// `WEBHOOK_URL`, `mostrarToast` e `formatarDataBR` continuam no script
// principal de index.html (WEBHOOK_URL e usado em ~20 outros lugares que
// ainda nao foram extraidos; os outros dois ainda nao viraram modulos
// proprios) - injetados em vez de importados.
export function createTarefasAgendaFeature({ WEBHOOK_URL, mostrarToast, formatarDataBR }) {
  function limparCampo(val) {
    if (!val) return '';
    const trimmed = val.trim();
    const placeholders = ['...', '…', 'descrição da tarefa', 'contexto da tarefa', 'prazo', 'nome da reunião', 'data da reunião', 'resumo extraído'];
    if (placeholders.includes(trimmed.toLowerCase())) return '';
    return val;
  }

  async function carregarTarefas() {
    if (WEBHOOK_URL.includes('SUA_URL_DO_WEBHOOK')) return;

    try {
      const res = await fetch(`${WEBHOOK_URL}?action=list_tasks`);
      const result = await res.json();
      const tbody = document.getElementById('tabela-tarefas');
      if (result.status === 'success' && result.data && result.data.length > 0) {
        tbody.innerHTML = '';
        result.data.forEach(t => {
          if (t.status === 'Concluída') return;
          const tarefa = limparCampo(t.tarefa);
          if (!tarefa) return;
          const contexto = limparCampo(t.contexto);
          const prazo = limparCampo(t.prazo);
          const nomeReuniao = limparCampo(t.nome_reuniao);
          const tr = document.createElement('tr');
          tr.innerHTML = `
                            <td>
                                <input type="checkbox" onchange="concluirTarefa('${t.id}')" style="width:1.2rem; height:1.2rem; cursor:pointer;">
                            </td>
                            <td style="font-weight:600;">${tarefa}</td>
                            <td style="color:var(--text-muted); font-size:0.9rem;">${contexto}</td>
                            <td><span class="status-badge" style="background:var(--surface-hover);">${prazo || 'Sem prazo'}</span></td>
                            <td style="font-size:0.85rem;">${nomeReuniao}<br><small>${formatarDataBR(t.data_reuniao)}</small></td>
                        `;
          tbody.appendChild(tr);
        });
        if (tbody.innerHTML === '') {
          tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhuma tarefa pendente.</td></tr>';
        }
      } else {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhuma tarefa encontrada.</td></tr>';
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function concluirTarefa(id) {
    try {
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'update_task_status',
          id: id,
          status: 'Concluída'
        })
      });
      mostrarToast('Tarefa concluída!', 'success');
      carregarTarefas();
    } catch (e) {
      mostrarToast('Erro ao concluir tarefa', 'error');
    }
  }

  async function sincronizarAgenda() {
    if (WEBHOOK_URL.includes('SUA_URL_DO_WEBHOOK')) {
      mostrarToast('Configure a URL do Webhook primeiro.', 'warning');
      return;
    }

    const btn = document.getElementById('btnSincronizarAgenda');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<div class="btn-spinner"></div> Sincronizando e Processando...';
    btn.disabled = true;

    try {
      const sheetRes = await fetch(`${WEBHOOK_URL}?action=sync_calendar&dias=5`);
      const sheetData = await sheetRes.json();

      if (sheetData.status !== 'success') {
        mostrarToast('Erro ao ler a agenda.', 'error');
        return;
      }

      const reunioes = sheetData.data || [];
      if (reunioes.length === 0) {
        mostrarToast('Nenhuma anotação de reunião encontrada hoje.', 'info');
        return;
      }

      let tarefasEncontradas = 0;
      let resumoConcat = '';

      for (const reuniao of reunioes) {
        const res = await reuniaoApi.processarReuniao({
          nome_reuniao: reuniao.nome,
          data_reuniao: reuniao.data,
          transcricao: reuniao.transcricao
        });

        const data = await res.json();
        if (!data.error) {
          if (data.minhas_tarefas && data.minhas_tarefas.length > 0) {
            tarefasEncontradas += data.minhas_tarefas.length;
          }
          if (data.resumo_geral) {
            resumoConcat += `<b>${reuniao.nome}</b>: ${data.resumo_geral}<br><br>`;
          }
        }
      }

      if (tarefasEncontradas > 0) {
        mostrarToast(`${tarefasEncontradas} novas tarefas extraídas!`, 'success');
      } else {
        mostrarToast('Agenda sincronizada. Nenhuma tarefa nova para você.', 'info');
      }

      if (resumoConcat) {
        document.getElementById('reuniao-resumo-container').style.display = 'block';
        document.getElementById('reuniao-resumo-texto').innerHTML = resumoConcat;
      }

      setTimeout(carregarTarefas, 1500);

    } catch (err) {
      console.error(err);
      mostrarToast('Erro ao sincronizar com o servidor.', 'error');
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  return { carregarTarefas, concluirTarefa, sincronizarAgenda };
}
