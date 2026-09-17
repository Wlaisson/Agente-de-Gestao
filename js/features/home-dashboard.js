import { state } from '../state.js';
import { getAppSvgIcon } from '../ui/icons.js';
import { calcularSegmentosDonut, construirCirculosSvg } from '../ui/donutChart.js';
import { tempoParaSegundos, segundosParaTempoSemMeta } from '../domain/tempo.js';

// atualizarHomeDashboard + seus dois renderizadores auxiliares, portados
// verbatim. Dependencias que ja viraram modulos proprios (state, icons,
// donutChart, tempo) sao importadas direto; o resto (obterTextoSemanaDeData,
// limparTempo, carregarCampanhas, carregarDadosPlanilha, atualizarDashboard,
// mostrarToast, formatarDataBR) ainda vive no script principal de
// index.html e e injetado.
export function createHomeDashboardFeature({
  obterTextoSemanaDeData,
  limparTempo,
  carregarCampanhas,
  carregarDadosPlanilha,
  atualizarDashboard,
  mostrarToast,
  formatarDataBR
}) {
  function renderizarDonutHome(projetosDados, totalSegundos) {
    const chartDiv = document.getElementById('home-donut-chart-svg');
    const legendDiv = document.getElementById('home-donut-chart-legend');
    if (!chartDiv || !legendDiv) return;

    if (!totalSegundos || totalSegundos === 0) {
      chartDiv.innerHTML = `
                    <svg width="140" height="140" viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="44" fill="none" stroke="var(--border)" stroke-width="12" />
                        <text x="60" y="65" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-weight="700">Sem dados</text>
                    </svg>
                `;
      legendDiv.innerHTML = `<div style="color: var(--text-muted); font-size: 0.82rem;">Nenhuma atividade com tempo registrada neste ciclo.</div>`;
      return;
    }

    const cores = ['#4f46e5', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#14b8a6'];
    const raio = 42;
    const projsArray = calcularSegmentosDonut(projetosDados, totalSegundos, cores);
    const circlesHTML = construirCirculosSvg(projsArray, raio, '0.4s');

    chartDiv.innerHTML = `
                <svg width="140" height="140" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="${raio}" fill="none" stroke="var(--surface-hover)" stroke-width="12" />
                    ${circlesHTML}
                </svg>
            `;

    let legendHTML = '';
    projsArray.slice(0, 5).forEach(p => {
      const horasStr = segundosParaTempoSemMeta(p.segundos);
      legendHTML += `
                    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.82rem; margin-bottom: 0.35rem;">
                        <div style="display: flex; align-items: center; gap: 0.4rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;">
                            <span style="width: 8px; height: 8px; border-radius: 50%; background-color: ${p.cor}; flex-shrink: 0;"></span>
                            <span style="font-weight: 500;">${p.nome}</span>
                        </div>
                        <div style="font-weight: 700; color: var(--text);">
                            ${horasStr}h <span style="color: var(--text-muted); font-size: 0.75rem; font-weight: 500;">(${p.porcentagem.toFixed(1)}%)</span>
                        </div>
                    </div>
                `;
    });
    legendDiv.innerHTML = legendHTML;
  }

  function renderizarAtividadesRecentesHome(atividades) {
    const container = document.getElementById('home-atividades-recentes-container');
    if (!container) return;

    if (!atividades || atividades.length === 0) {
      container.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.9rem;">
                        Nenhuma atividade recente encontrada neste ciclo.
                    </div>
                `;
      return;
    }

    const ultimas = [...atividades].sort((a, b) => new Date(b.data) - new Date(a.data)).slice(0, 5);

    let html = '';
    ultimas.forEach(act => {
      const tempoLimpo = limparTempo(act.tempo);
      html += `
                    <div class="recent-act-item">
                        <div class="recent-act-left">
                            <span class="recent-act-title">${act.titulo || act.atividade || 'Atividade'}</span>
                            <div class="recent-act-meta">
                                <span style="font-weight: 600; color: var(--text);">${act.projeto}</span>
                                ${act.assuntoInterno ? `<span>•</span> <span style="color: var(--primary); font-weight: 600;">${act.assuntoInterno}</span>` : ''}
                                <span>•</span>
                                <span>${formatarDataBR(act.data)}</span>
                            </div>
                        </div>
                        <span class="recent-act-time">${tempoLimpo}</span>
                    </div>
                `;
    });
    container.innerHTML = html;
  }

  function atualizarHomeDashboard(forcado = false) {
    const dataFoco = new Date();
    const textoSemana = obterTextoSemanaDeData(dataFoco);

    const topbarSemana = document.getElementById('topbar-semana-atual');
    if (topbarSemana) {
      topbarSemana.textContent = `Semana: ${textoSemana}`;
    }

    const atividadesSemana = state.todasAtividades.filter(act => act.semana === textoSemana);

    let totalSegundos = 0;
    const projetosDados = {};

    atividadesSemana.forEach(act => {
      const duracaoLimpa = limparTempo(act.tempo);
      const segs = tempoParaSegundos(duracaoLimpa);
      totalSegundos += segs;

      if (!projetosDados[act.projeto]) {
        projetosDados[act.projeto] = 0;
      }
      projetosDados[act.projeto] += segs;
    });

    const horasStr = segundosParaTempoSemMeta(totalSegundos);
    const horasEl = document.getElementById('home-horas-semana');
    if (horasEl) horasEl.textContent = horasStr;

    const segundosMeta = 40 * 3600;
    const pctMeta = Math.min(100, Math.round((totalSegundos / segundosMeta) * 100));
    const barEl = document.getElementById('home-horas-bar');
    if (barEl) barEl.style.width = `${pctMeta}%`;

    const pctEl = document.getElementById('home-horas-pct');
    if (pctEl) pctEl.textContent = `${pctMeta}% da meta de 40h cumprida`;

    const statusHorasEl = document.getElementById('home-horas-status');
    if (statusHorasEl) {
      if (pctMeta >= 100) {
        statusHorasEl.innerHTML = 'Meta Atingida! ' + getAppSvgIcon('trophy');
        statusHorasEl.className = 'kpi-badge badge-emerald';
      } else if (pctMeta >= 75) {
        statusHorasEl.innerHTML = 'Quase lá ' + getAppSvgIcon('sparkles');
        statusHorasEl.className = 'kpi-badge badge-indigo';
      } else {
        statusHorasEl.textContent = 'Ciclo Atual';
        statusHorasEl.className = 'kpi-badge badge-indigo';
      }
    }

    const cards = (typeof state.kanbanCards !== 'undefined' && Array.isArray(state.kanbanCards)) ? state.kanbanCards : [];
    const afazer = cards.filter(c => (c.status || 'A Fazer') === 'A Fazer').length;
    const andamento = cards.filter(c => c.status === 'Em Andamento').length;
    const concluidas = cards.filter(c => c.status === 'Concluído').length;
    const abertas = afazer + andamento;

    const kanbanAbertasEl = document.getElementById('home-kanban-abertas');
    if (kanbanAbertasEl) kanbanAbertasEl.textContent = abertas;

    const kanbanAfazerEl = document.getElementById('home-kanban-afazer');
    if (kanbanAfazerEl) kanbanAfazerEl.textContent = `${afazer}`;

    const kanbanAndamentoEl = document.getElementById('home-kanban-andamento');
    if (kanbanAndamentoEl) kanbanAndamentoEl.textContent = `${andamento}`;

    const kanbanConcluidasEl = document.getElementById('home-kanban-concluidas');
    if (kanbanConcluidasEl) kanbanConcluidasEl.textContent = `${concluidas}`;

    const badgeKanban = document.getElementById('badge-kanban-abertas');
    if (badgeKanban) badgeKanban.textContent = abertas;

    const dashHojeHoras = document.getElementById('dash-horas-hoje');
    const dashHojeAtiv = document.getElementById('dash-atividades');
    const homeHojeHoras = document.getElementById('home-horas-hoje');
    const homeHojeAtiv = document.getElementById('home-atividades-hoje');
    if (dashHojeHoras && homeHojeHoras) homeHojeHoras.textContent = dashHojeHoras.textContent || '00:00';
    if (dashHojeAtiv && homeHojeAtiv) homeHojeAtiv.textContent = dashHojeAtiv.textContent || '0';

    const campanhas = carregarCampanhas();
    const campAtivas = campanhas.filter(c => c.status === 'Ativa').length;
    const campProg = campanhas.filter(c => c.status === 'Programada').length;

    const campTotalEl = document.getElementById('home-campanhas-total');
    if (campTotalEl) campTotalEl.textContent = campanhas.length;

    const campBadgeEl = document.getElementById('home-campanhas-badge');
    if (campBadgeEl) campBadgeEl.textContent = `${campAtivas} Ativa${campAtivas === 1 ? '' : 's'}`;

    const campResumoEl = document.getElementById('home-campanhas-resumo');
    if (campResumoEl) campResumoEl.textContent = `${campAtivas} ativa${campAtivas === 1 ? '' : 's'} • ${campProg} programada${campProg === 1 ? '' : 's'}`;

    const badgeCamp = document.getElementById('badge-campanhas-ativas');
    if (badgeCamp) badgeCamp.textContent = campAtivas;

    renderizarDonutHome(projetosDados, totalSegundos);
    renderizarAtividadesRecentesHome(atividadesSemana);

    if (forcado) {
      carregarDadosPlanilha().then(() => {
        atualizarDashboard();
        atualizarHomeDashboard();
        mostrarToast('Painel sincronizado com sucesso!', 'success');
      });
    }
  }

  return { atualizarHomeDashboard, renderizarDonutHome, renderizarAtividadesRecentesHome };
}
