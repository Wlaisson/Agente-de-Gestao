# Variáveis de ambiente

Nenhum `.env.example` existia antes deste documento, e nenhuma dessas variáveis
estava documentada em outro lugar do repositório. Lista extraída por leitura
direta do código-fonte (`server.js`, `supabaseClient.js`, `scripts/criar_admin.js`).

## Supabase (`supabaseClient.js`)

| Variável | Obrigatória | Uso |
|---|---|---|
| `SUPABASE_URL` | Sim | URL do projeto Supabase, usada por ambos os clientes (`supabase` e `supabaseAdmin`). |
| `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_ANON_KEY` / `SUPABASE_KEY` | Sim (uma delas) | Chave anônima/pública, usada para criar o cliente `supabase` (contexto do usuário final, ex.: login). Lidas nessa ordem de precedência. |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` | Sim (uma delas) | Chave de service role, usada para criar o cliente `supabaseAdmin` (bypassa RLS — usado na maioria das rotas). Lidas nessa ordem de precedência. |

Sem essas variáveis, `createClient()` lança `supabaseUrl is required.` na importação
de `supabaseClient.js` — ou seja, o processo falha ao subir, não apenas em runtime.

## OpenAI (`server.js`)

| Variável | Obrigatória | Uso |
|---|---|---|
| `OPENAI_API_KEY` | Não (mas necessária para as rotas de IA funcionarem) | Cria o cliente OpenAI global (`openaiGlobal`). Se ausente, cada usuário precisa ter sua própria chave configurada em `setup_usuario` (ver `/api/setup`); na ausência de ambas, `obterClienteOpenAI` cai num terceiro nível que pode usar a chave de **outro** usuário qualquer com uma chave cadastrada (ver call-out de segurança no plano de reorganização). |
| `OPENAI_MODEL` | Não | Sobrepõe o primeiro modelo da lista de fallback (`MODELOS`); padrão `gpt-5-nano`. |

## Deploy / runtime

| Variável | Obrigatória | Uso |
|---|---|---|
| `VERCEL` | Definida automaticamente pela Vercel | Quando presente, `server.js` não chama `app.listen(...)` (o runtime serverless da Vercel cuida disso via `api/index.js`). |

## Script de bootstrap (`scripts/criar_admin.js`)

| Variável | Obrigatória | Uso |
|---|---|---|
| `ADMIN_EMAIL` | Não | E-mail do admin a criar/atualizar; padrão `admin@report.com` se nem argumento de linha de comando nem env var forem passados. |
| `ADMIN_PASSWORD` | Não | Senha do admin; padrão `Admin@123456`. |

## Configuração hardcoded que deveria ser env var (flag, não corrigido nesta fase)

- `port = 5555` em `server.js` — porta fixa para execução local (`npm start`), ignorada quando `VERCEL` está definida.
- Uma URL de webhook do Google Apps Script (`WEBHOOK_URL` em `server.js`) — endpoint legado usado como espelho de escrita para atividades/kanban/reuniões, hoje hardcoded no código-fonte em vez de configurável via ambiente.

Essas duas serão movidas para `config/env.js` na Fase 1 da reorganização, mantendo
os mesmos valores-padrão como fallback (nenhuma mudança de comportamento).
