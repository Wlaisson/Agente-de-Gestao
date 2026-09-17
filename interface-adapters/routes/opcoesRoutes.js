import { Router } from 'express';

export function createOpcoesRoutes({ opcoesController }) {
  const router = Router();
  router.get('/api/opcoes', opcoesController.obter);
  router.post('/api/opcoes', opcoesController.atualizar);
  return router;
}
