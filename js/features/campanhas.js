import { state } from '../state.js';
import { getAppSvgIcon } from '../ui/icons.js';

// Feature 100% local (localStorage `gestao_campanhas`, sem backend nenhum),
// portada verbatim de index.html. `mostrarToast`, `formatarDataBR` e
// `atualizarHomeDashboard` continuam no script principal (ainda nao viraram
// modulos proprios) - injetados aqui em vez de importados, para nao acoplar
// esta feature a peças que ainda nao foram extraidas.
export function createCampanhasFeature({ mostrarToast, formatarDataBR, atualizarHomeDashboard }) {
  let filtroCampanhaAtual = 'Todas';

  function carregarCampanhas() {
    try {
      const gravadas = localStorage.getItem('gestao_campanhas');
      if (gravadas) {
        state.campanhasDados = JSON.parse(gravadas);
      } else {
        state.campanhasDados = [
          {
            id: 'CMP-1',
            nome: 'Estruturação da Base de Fabricantes Viamar',
            projeto: 'Projetos - Rede Pró',
            status: 'Ativa',
            dataInicio: '2026-09-01',
            dataFim: '2026-09-30',
            metaHoras: 40,
            progresso: 65,
            descricao: 'Normalização, padronização e catalogação completa de aplicações de peças.'
          },
          {
            id: 'CMP-2',
            nome: 'Automação de Extração e Scraping de Catálogos',
            projeto: 'Interno',
            status: 'Ativa',
            dataInicio: '2026-09-05',
            dataFim: '2026-09-20',
            metaHoras: 25,
            progresso: 40,
            descricao: 'Implementação de scripts de scraping com validação fonética e correção de nomes.'
          },
          {
            id: 'CMP-3',
            nome: 'Migração de Dados e Vista Explodida',
            projeto: 'Projetos - Agrominas',
            status: 'Programada',
            dataInicio: '2026-09-15',
            dataFim: '2026-10-15',
            metaHoras: 50,
            progresso: 10,
            descricao: 'Tratamento de vistas explodidas para peças do catálogo industrial.'
          }
        ];
        localStorage.setItem('gestao_campanhas', JSON.stringify(state.campanhasDados));
      }
    } catch (e) {
      state.campanhasDados = [];
    }
    return state.campanhasDados;
  }

  function salvarCampanhasLocais() {
    localStorage.setItem('gestao_campanhas', JSON.stringify(state.campanhasDados));
    renderizarCampanhas(filtroCampanhaAtual);
    atualizarHomeDashboard();
  }

  function renderizarCampanhas(filtro = filtroCampanhaAtual) {
    filtroCampanhaAtual = filtro;
    carregarCampanhas();

    const total = state.campanhasDados.length;
    const ativas = state.campanhasDados.filter(c => c.status === 'Ativa').length;
    const programadas = state.campanhasDados.filter(c => c.status === 'Programada').length;
    const concluidas = state.campanhasDados.filter(c => c.status === 'Concluída').length;
    const pausadas = state.campanhasDados.filter(c => c.status === 'Pausada').length;

    const elTotal = document.getElementById('camp-total');
    const elAtivas = document.getElementById('camp-ativas');
    const elProg = document.getElementById('camp-programadas');
    const elConc = document.getElementById('camp-concluidas');
    if (elTotal) elTotal.textContent = total;
    if (elAtivas) elAtivas.textContent = ativas;
    if (elProg) elProg.textContent = programadas;
    if (elConc) elConc.textContent = concluidas;

    const cTodas = document.getElementById('camp-count-todas');
    const cAtivas = document.getElementById('camp-count-ativas');
    const cProg = document.getElementById('camp-count-programadas');
    const cConc = document.getElementById('camp-count-concluidas');
    const cPaus = document.getElementById('camp-count-pausadas');
    if (cTodas) cTodas.textContent = total;
    if (cAtivas) cAtivas.textContent = ativas;
    if (cProg) cProg.textContent = programadas;
    if (cConc) cConc.textContent = concluidas;
    if (cPaus) cPaus.textContent = pausadas;

    const container = document.getElementById('campanhas-container');
    if (!container) return;

    const filtradas = filtro === 'Todas' ? state.campanhasDados : state.campanhasDados.filter(c => c.status === filtro);

    if (filtradas.length === 0) {
      container.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted); background: var(--surface); border-radius: 16px; border: 1px dashed var(--border);">
                        <div style="display: flex; justify-content: center; margin-bottom: 0.5rem; color: var(--text-muted);">${getAppSvgIcon('target', 'app-icon-xl')}</div>
                        <h3 style="font-size: 1.1rem; color: var(--text); margin-bottom: 0.25rem;">Nenhuma campanha encontrada</h3>
                        <p style="font-size: 0.85rem; margin-bottom: 1rem;">Nenhuma campanha cadastrada com o status "${filtro}".</p>
                        <button class="btn btn-primary" onclick="abrirModalCampanha()"><span>${getAppSvgIcon('plus')}</span> Criar Nova Campanha</button>
                    </div>
                `;
      return;
    }

    let html = '';
    filtradas.forEach(c => {
      const statusClass = `status-${c.status.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, "")}`;
      const progresso = c.progresso || 0;
      html += `
                    <div class="campanha-card">
                        <div class="campanha-header">
                            <div>
                                <div class="campanha-name">${c.nome}</div>
                                <div class="campanha-project">
                                    <span>${getAppSvgIcon('building', 'app-icon-sm')}</span>
                                    <span>${c.projeto}</span>
                                </div>
                            </div>
                            <span class="campanha-badge-status ${statusClass}">${c.status}</span>
                        </div>

                        <div class="campanha-body">
                            <p style="line-height: 1.4; font-size: 0.85rem; color: var(--text-muted);">${c.descricao || 'Sem descrição cadastrada.'}</p>
                            <div class="campanha-dates">
                                <span>${getAppSvgIcon('calendar', 'app-icon-sm')} Início: ${formatarDataBR(c.dataInicio)}</span>
                                <span>${getAppSvgIcon('flag', 'app-icon-sm')} Fim: ${formatarDataBR(c.dataFim)}</span>
                            </div>
                            <div>
                                <div style="display: flex; justify-content: space-between; font-size: 0.78rem; font-weight: 600; margin-bottom: 0.35rem;">
                                    <span>Progresso da Campanha</span>
                                    <span>${progresso}%</span>
                                </div>
                                <div class="kpi-progress-bar" style="margin-top: 0;">
                                    <div class="kpi-progress-fill" style="width: ${progresso}%;"></div>
                                </div>
                            </div>
                        </div>

                        <div class="campanha-footer">
                            <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500;">
                                ${c.metaHoras ? `${getAppSvgIcon('clock', 'app-icon-sm')} <strong>${c.metaHoras}h</strong> estimadas` : ''}
                            </span>
                            <div class="campanha-actions">
                                <button class="btn-edit" onclick="abrirModalCampanha('${c.id}')" style="padding: 0.35rem 0.65rem;">
                                    <span>${getAppSvgIcon('edit', 'app-icon-sm')}</span> Editar
                                </button>
                                <button class="btn-delete" onclick="excluirCampanha('${c.id}')" style="padding: 0.35rem 0.65rem;">
                                    <span>${getAppSvgIcon('trash', 'app-icon-sm')}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
    });
    container.innerHTML = html;
  }

  function filtrarCampanhas(status, ev) {
    document.querySelectorAll('.campanha-filter-btn').forEach(btn => btn.classList.remove('active'));
    if (ev && ev.currentTarget) ev.currentTarget.classList.add('active');
    renderizarCampanhas(status);
  }

  function abrirModalCampanha(id = null) {
    const modal = document.getElementById('campanhaModal');
    const title = document.getElementById('campanhaModalTitle');
    const form = document.getElementById('campanhaForm');
    form.reset();

    if (id) {
      const camp = state.campanhasDados.find(c => c.id === id);
      if (camp) {
        title.textContent = 'Editar Campanha';
        document.getElementById('camp-id').value = camp.id;
        document.getElementById('camp-nome').value = camp.nome;
        document.getElementById('camp-projeto').value = camp.projeto;
        document.getElementById('camp-status').value = camp.status;
        document.getElementById('camp-data-inicio').value = camp.dataInicio;
        document.getElementById('camp-data-fim').value = camp.dataFim;
        document.getElementById('camp-meta-horas').value = camp.metaHoras || '';
        document.getElementById('camp-progresso').value = camp.progresso || 0;
        document.getElementById('camp-descricao').value = camp.descricao || '';
      }
    } else {
      title.textContent = 'Nova Campanha';
      document.getElementById('camp-id').value = '';
      const hoje = new Date().toISOString().split('T')[0];
      document.getElementById('camp-data-inicio').value = hoje;
      const fim = new Date();
      fim.setDate(fim.getDate() + 30);
      document.getElementById('camp-data-fim').value = fim.toISOString().split('T')[0];
      document.getElementById('camp-status').value = 'Ativa';
    }
    modal.classList.add('active');
  }

  function fecharModalCampanha() {
    const modal = document.getElementById('campanhaModal');
    if (modal) modal.classList.remove('active');
  }

  function salvarCampanha(event) {
    event.preventDefault();
    const id = document.getElementById('camp-id').value;
    const nome = document.getElementById('camp-nome').value.trim();
    const projeto = document.getElementById('camp-projeto').value;
    const status = document.getElementById('camp-status').value;
    const dataInicio = document.getElementById('camp-data-inicio').value;
    const dataFim = document.getElementById('camp-data-fim').value;
    const metaHoras = Number(document.getElementById('camp-meta-horas').value) || 0;
    const progresso = Number(document.getElementById('camp-progresso').value) || 0;
    const descricao = document.getElementById('camp-descricao').value.trim();

    if (!nome || !projeto || !dataInicio || !dataFim) {
      mostrarToast('Preencha os campos obrigatórios da campanha.', 'warning');
      return;
    }

    if (id) {
      const idx = state.campanhasDados.findIndex(c => c.id === id);
      if (idx !== -1) {
        state.campanhasDados[idx] = { ...state.campanhasDados[idx], nome, projeto, status, dataInicio, dataFim, metaHoras, progresso, descricao };
        mostrarToast('Campanha atualizada com sucesso!', 'success');
      }
    } else {
      const novoId = 'CMP-' + Date.now();
      state.campanhasDados.unshift({ id: novoId, nome, projeto, status, dataInicio, dataFim, metaHoras, progresso, descricao });
      mostrarToast('Campanha criada com sucesso!', 'success');
    }

    salvarCampanhasLocais();
    fecharModalCampanha();
  }

  function excluirCampanha(id) {
    if (!confirm('Tem certeza que deseja excluir esta campanha?')) return;
    state.campanhasDados = state.campanhasDados.filter(c => c.id !== id);
    salvarCampanhasLocais();
    mostrarToast('Campanha removida.', 'info');
  }

  return {
    carregarCampanhas,
    salvarCampanhasLocais,
    renderizarCampanhas,
    filtrarCampanhas,
    abrirModalCampanha,
    fecharModalCampanha,
    salvarCampanha,
    excluirCampanha
  };
}
