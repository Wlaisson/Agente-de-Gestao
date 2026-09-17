import { Router } from 'express';

export function createAuthRoutes({ authController }) {
  const router = Router();
  router.post('/api/auth/login', authController.login);
  return router;
}
