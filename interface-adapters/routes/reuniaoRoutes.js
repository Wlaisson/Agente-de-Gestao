import { Router } from 'express';

export function createReuniaoRoutes({ reuniaoController }) {
  const router = Router();
  router.post('/api/processar-reuniao', reuniaoController.processar);
  return router;
}
