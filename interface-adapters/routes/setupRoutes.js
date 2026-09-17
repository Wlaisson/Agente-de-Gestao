import { Router } from 'express';

export function createSetupRoutes({ setupController }) {
  const router = Router();
  router.get('/api/setup/:userId', setupController.obter);
  router.post('/api/setup', setupController.salvar);
  return router;
}
