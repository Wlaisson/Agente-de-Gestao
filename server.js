import 'dotenv/config';
import { createApp } from './infrastructure/express/app.js';
import { PORT } from './config/env.js';

const app = createApp();

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

export default app;
