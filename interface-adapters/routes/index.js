import { Router } from 'express';
import { supabase, supabaseAdmin } from '../../supabaseClient.js';
import { verificarAdmin } from '../../middleware/verificarAdmin.js';
import { createSupabaseUsuarioRepository } from '../repositories/SupabaseUsuarioRepository.js';
import { createSupabaseOpcoesRepository } from '../repositories/SupabaseOpcoesRepository.js';
import { makeAutenticarUsuarioUseCase } from '../../application/use-cases/auth/AutenticarUsuarioUseCase.js';
import { makeCriarUsuarioUseCase } from '../../application/use-cases/admin/CriarUsuarioUseCase.js';
import { makeListarUsuariosUseCase } from '../../application/use-cases/admin/ListarUsuariosUseCase.js';
import { makeExcluirUsuarioUseCase } from '../../application/use-cases/admin/ExcluirUsuarioUseCase.js';
import { makeObterOpcoesUseCase } from '../../application/use-cases/opcoes/ObterOpcoesUseCase.js';
import { makeAtualizarOpcoesUseCase } from '../../application/use-cases/opcoes/AtualizarOpcoesUseCase.js';
import { makeAuthController } from '../controllers/authController.js';
import { makeAdminController } from '../controllers/adminController.js';
import { makeOpcoesController } from '../controllers/opcoesController.js';
import { createAuthRoutes } from './authRoutes.js';
import { createAdminRoutes } from './adminRoutes.js';
import { createOpcoesRoutes } from './opcoesRoutes.js';
import legacyRoutes from './legacyRoutes.js';

// Composition root: monta repositories -> use-cases -> controllers -> routers
// para os dominios ja migrados (Auth/Admin), e monta o restante (ainda nao
// migrado) via legacyRoutes.js. A medida que cada dominio for migrado nas
// proximas fases, ganha sua propria secao aqui e legacyRoutes.js encolhe.
export function createRoutes() {
  const usuarioRepository = createSupabaseUsuarioRepository({ supabase, supabaseAdmin });
  const opcoesRepository = createSupabaseOpcoesRepository({ supabaseAdmin });

  const autenticarUsuario = makeAutenticarUsuarioUseCase({ usuarioRepository });
  const criarUsuario = makeCriarUsuarioUseCase({ usuarioRepository });
  const listarUsuarios = makeListarUsuariosUseCase({ usuarioRepository });
  const excluirUsuario = makeExcluirUsuarioUseCase({ usuarioRepository });
  const obterOpcoes = makeObterOpcoesUseCase({ opcoesRepository });
  const atualizarOpcoes = makeAtualizarOpcoesUseCase({ opcoesRepository });

  const authController = makeAuthController({ autenticarUsuario });
  const adminController = makeAdminController({ criarUsuario, listarUsuarios, excluirUsuario });
  const opcoesController = makeOpcoesController({ obterOpcoes, atualizarOpcoes });

  const router = Router();
  router.use(createAuthRoutes({ authController }));
  router.use(createAdminRoutes({ adminController, verificarAdmin }));
  router.use(createOpcoesRoutes({ opcoesController }));
  router.use(legacyRoutes);
  return router;
}
