import { calcularMetadadosData } from '../../../domain/services/WeekCalculator.js';
import { mapearLinhaParaResposta } from '../../../interface-adapters/mappers/AtividadePayloadMapper.js';

// Portado verbatim de GET /api/atividades. NOTA (flag, nao corrigido nesta
// fase - ver plano de reorganizacao): `todos=true` ignora o escopo por
// usuario sem nenhuma checagem de admin, exatamente como no server.js
// original.
export function makeListarAtividadesUseCase({ atividadeRepository }) {
  return async function listarAtividades({ userId, todos, semana, start, end }) {
    if (!userId) {
      const erro = new Error('Usuário não autenticado.');
      erro.status = 401;
      throw erro;
    }

    const { data, error } = await atividadeRepository.listar({ userId, todos, semana, start, end });
    if (error) {
      const erro = new Error(error.message);
      erro.status = 500;
      throw erro;
    }

    return (data || []).map(item => mapearLinhaParaResposta(item, calcularMetadadosData));
  };
}
