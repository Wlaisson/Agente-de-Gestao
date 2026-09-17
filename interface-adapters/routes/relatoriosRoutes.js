import { Router } from 'express';

export function createRelatoriosRoutes({ relatoriosController }) {
  const router = Router();
  router.post('/api/gerar-relatorio', relatoriosController.gerarConsolidado);
  router.post('/api/gerar-relatorio-reporter', relatoriosController.gerarReporter);
  return router;
}
