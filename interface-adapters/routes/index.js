import { Router } from 'express';
import { supabase, supabaseAdmin } from '../../supabaseClient.js';
import { verificarAdmin } from '../../middleware/verificarAdmin.js';
import { createSupabaseUsuarioRepository } from '../repositories/SupabaseUsuarioRepository.js';
import { createSupabaseOpcoesRepository } from '../repositories/SupabaseOpcoesRepository.js';
import { createSupabaseAtividadeRepository } from '../repositories/SupabaseAtividadeRepository.js';
import { createSupabaseKanbanRepository } from '../repositories/SupabaseKanbanRepository.js';
import { createSupabaseSetupRepository } from '../repositories/SupabaseSetupRepository.js';
import { createOpenAIGateway } from '../gateways/OpenAIGateway.js';
import { createEmbeddingsGateway } from '../gateways/EmbeddingsGateway.js';
import { openaiGlobal, MODELOS, MODELO_EMBEDDING } from '../../infrastructure/openai/openaiClient.js';
import { makeAutenticarUsuarioUseCase } from '../../application/use-cases/auth/AutenticarUsuarioUseCase.js';
import { makeCriarUsuarioUseCase } from '../../application/use-cases/admin/CriarUsuarioUseCase.js';
import { makeListarUsuariosUseCase } from '../../application/use-cases/admin/ListarUsuariosUseCase.js';
import { makeExcluirUsuarioUseCase } from '../../application/use-cases/admin/ExcluirUsuarioUseCase.js';
import { makeObterOpcoesUseCase } from '../../application/use-cases/opcoes/ObterOpcoesUseCase.js';
import { makeAtualizarOpcoesUseCase } from '../../application/use-cases/opcoes/AtualizarOpcoesUseCase.js';
import { makeListarAtividadesUseCase } from '../../application/use-cases/atividades/ListarAtividadesUseCase.js';
import { makeCriarAtividadeUseCase } from '../../application/use-cases/atividades/CriarAtividadeUseCase.js';
import { makeAtualizarAtividadeUseCase } from '../../application/use-cases/atividades/AtualizarAtividadeUseCase.js';
import { makeExcluirAtividadeUseCase } from '../../application/use-cases/atividades/ExcluirAtividadeUseCase.js';
import { makeListarCardsUseCase } from '../../application/use-cases/kanban/ListarCardsUseCase.js';
import { makeAdicionarCardUseCase } from '../../application/use-cases/kanban/AdicionarCardUseCase.js';
import { makeAtualizarStatusCardUseCase } from '../../application/use-cases/kanban/AtualizarStatusCardUseCase.js';
import { makeExcluirCardUseCase } from '../../application/use-cases/kanban/ExcluirCardUseCase.js';
import { makeConcluirCardUseCase } from '../../application/use-cases/kanban/ConcluirCardUseCase.js';
import { makeEditarCardUseCase } from '../../application/use-cases/kanban/EditarCardUseCase.js';
import { makeTranscreverAudioParaAtividadeUseCase } from '../../application/use-cases/transcricao/TranscreverAudioParaAtividadeUseCase.js';
import { makeTranscreverAudioParaCardUseCase } from '../../application/use-cases/transcricao/TranscreverAudioParaCardUseCase.js';
import { makeGerarRelatorioSemanalUseCase } from '../../application/use-cases/relatorios/GerarRelatorioSemanalUseCase.js';
import { makeObterConfigUsuarioUseCase } from '../../application/use-cases/setup/ObterConfigUsuarioUseCase.js';
import { makeSalvarConfigUsuarioUseCase } from '../../application/use-cases/setup/SalvarConfigUsuarioUseCase.js';
import { makeProcessarReuniaoUseCase } from '../../application/use-cases/reuniao/ProcessarReuniaoUseCase.js';
import { makeAuthController } from '../controllers/authController.js';
import { makeAdminController } from '../controllers/adminController.js';
import { makeOpcoesController } from '../controllers/opcoesController.js';
import { makeAtividadesController } from '../controllers/atividadesController.js';
import { makeKanbanController } from '../controllers/kanbanController.js';
import { makeTranscricaoController } from '../controllers/transcricaoController.js';
import { makeRelatoriosController } from '../controllers/relatoriosController.js';
import { makeSetupController } from '../controllers/setupController.js';
import { makeReuniaoController } from '../controllers/reuniaoController.js';
import { createAuthRoutes } from './authRoutes.js';
import { createAdminRoutes } from './adminRoutes.js';
import { createOpcoesRoutes } from './opcoesRoutes.js';
import { createAtividadesRoutes } from './atividadesRoutes.js';
import { createKanbanRoutes } from './kanbanRoutes.js';
import { createTranscricaoRoutes } from './transcricaoRoutes.js';
import { createRelatoriosRoutes } from './relatoriosRoutes.js';
import { createSetupRoutes } from './setupRoutes.js';
import { createReuniaoRoutes } from './reuniaoRoutes.js';

// Composition root: monta repositories -> use-cases -> controllers -> routers
// para todos os 9 dominios do backend. legacyRoutes.js (a rede de seguranca
// temporaria das fases 3-9) foi esvaziado e removido nesta fase.
export function createRoutes() {
  const usuarioRepository = createSupabaseUsuarioRepository({ supabase, supabaseAdmin });
  const opcoesRepository = createSupabaseOpcoesRepository({ supabaseAdmin });
  const atividadeRepository = createSupabaseAtividadeRepository({ supabaseAdmin });
  const kanbanRepository = createSupabaseKanbanRepository({ supabase, supabaseAdmin });
  const setupRepository = createSupabaseSetupRepository({ supabaseAdmin });
  const openAIGateway = createOpenAIGateway({ supabaseAdmin, openaiGlobal, modelosPadrao: MODELOS });
  const embeddingsGateway = createEmbeddingsGateway({ modeloEmbedding: MODELO_EMBEDDING });

  const autenticarUsuario = makeAutenticarUsuarioUseCase({ usuarioRepository });
  const criarUsuario = makeCriarUsuarioUseCase({ usuarioRepository });
  const listarUsuarios = makeListarUsuariosUseCase({ usuarioRepository });
  const excluirUsuario = makeExcluirUsuarioUseCase({ usuarioRepository });
  const obterOpcoes = makeObterOpcoesUseCase({ opcoesRepository });
  const atualizarOpcoes = makeAtualizarOpcoesUseCase({ opcoesRepository });
  const listarAtividades = makeListarAtividadesUseCase({ atividadeRepository });
  const criarAtividade = makeCriarAtividadeUseCase({ atividadeRepository, openAIGateway, embeddingsGateway });
  const atualizarAtividade = makeAtualizarAtividadeUseCase({ atividadeRepository, openAIGateway, embeddingsGateway });
  const excluirAtividade = makeExcluirAtividadeUseCase({ atividadeRepository });
  const listarCards = makeListarCardsUseCase({ kanbanRepository });
  const adicionarCard = makeAdicionarCardUseCase({ kanbanRepository, openAIGateway, embeddingsGateway });
  const atualizarStatusCard = makeAtualizarStatusCardUseCase({ kanbanRepository });
  const excluirCard = makeExcluirCardUseCase({ kanbanRepository });
  const concluirCard = makeConcluirCardUseCase({ kanbanRepository });
  const editarCard = makeEditarCardUseCase({ kanbanRepository, openAIGateway, embeddingsGateway });
  const transcreverAudioParaAtividade = makeTranscreverAudioParaAtividadeUseCase({ openAIGateway, embeddingsGateway, opcoesRepository, atividadeRepository });
  const transcreverAudioParaCard = makeTranscreverAudioParaCardUseCase({ openAIGateway, embeddingsGateway, opcoesRepository, kanbanRepository });
  const gerarRelatorioSemanal = makeGerarRelatorioSemanalUseCase({ atividadeRepository, openAIGateway, embeddingsGateway });
  const obterConfigUsuario = makeObterConfigUsuarioUseCase({ setupRepository });
  const salvarConfigUsuario = makeSalvarConfigUsuarioUseCase({ setupRepository });
  const processarReuniao = makeProcessarReuniaoUseCase({ openAIGateway, embeddingsGateway, atividadeRepository, kanbanRepository });

  const authController = makeAuthController({ autenticarUsuario });
  const adminController = makeAdminController({ criarUsuario, listarUsuarios, excluirUsuario });
  const opcoesController = makeOpcoesController({ obterOpcoes, atualizarOpcoes });
  const atividadesController = makeAtividadesController({
    listarAtividades,
    criarAtividade,
    atualizarAtividade,
    excluirAtividade
  });
  const kanbanController = makeKanbanController({
    listarCards,
    adicionarCard,
    atualizarStatusCard,
    excluirCard,
    concluirCard,
    editarCard
  });
  const transcricaoController = makeTranscricaoController({
    transcreverAudioParaAtividade,
    transcreverAudioParaCard
  });
  const relatoriosController = makeRelatoriosController({ gerarRelatorioSemanal, openAIGateway });
  const setupController = makeSetupController({ obterConfigUsuario, salvarConfigUsuario });
  const reuniaoController = makeReuniaoController({ processarReuniao });

  const router = Router();
  router.use(createAuthRoutes({ authController }));
  router.use(createAdminRoutes({ adminController, verificarAdmin }));
  router.use(createOpcoesRoutes({ opcoesController }));
  router.use(createAtividadesRoutes({ atividadesController }));
  router.use(createKanbanRoutes({ kanbanController }));
  router.use(createTranscricaoRoutes({ transcricaoController }));
  router.use(createRelatoriosRoutes({ relatoriosController }));
  router.use(createSetupRoutes({ setupController }));
  router.use(createReuniaoRoutes({ reuniaoController }));
  return router;
}
