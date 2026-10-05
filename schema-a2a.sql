-- Rodar manualmente no SQL Editor do Supabase (nao ha ferramenta de execucao
-- automatica de SQL neste projeto - mesmo procedimento de schema-embeddings.sql).
-- Idempotente: seguro rodar mais de uma vez.
--
-- Enquanto isto nao for aplicado, o sistema de agentes FUNCIONA, mas as
-- tarefas e a auditoria ficam apenas em memoria do processo (ver o aviso em
-- SupabaseTarefaA2ARepository.js). Em serverless com mais de uma instancia
-- isso quebra o fluxo de confirmacao de escrita: a confirmacao pode chegar
-- numa instancia que nunca viu a proposta. Aplique antes de uso real.

-- ---------------------------------------------------------------------------
-- Tarefas A2A
-- ---------------------------------------------------------------------------
-- O documento inteiro da tarefa vive em jsonb (`status`, `history`,
-- `artifacts`, `metadata`) porque o formato e ditado pela especificacao A2A,
-- nao por este banco: normalizar em colunas exigiria migration a cada
-- evolucao do protocolo. As colunas soltas sao so as que precisam de indice
-- ou de integridade referencial.
create table if not exists a2a_tarefas (
  id text primary key,
  context_id text not null,
  agent_id text not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  -- Duplica status->>'state' numa coluna propria: filtrar tarefa pendente
  -- por jsonb exigiria indice de expressao e deixaria a query menos obvia.
  estado text not null,
  status jsonb not null,
  history jsonb not null default '[]'::jsonb,
  artifacts jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default timezone('utc'::text, now()),
  atualizado_em timestamptz not null default timezone('utc'::text, now())
);

create index if not exists idx_a2a_tarefas_context on a2a_tarefas(context_id, criado_em);
create index if not exists idx_a2a_tarefas_user on a2a_tarefas(user_id, atualizado_em desc);
-- Consulta quente: tarefas de um usuario esperando confirmacao.
create index if not exists idx_a2a_tarefas_estado on a2a_tarefas(user_id, estado)
  where estado in ('submitted', 'working', 'input-required');

-- ---------------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------------
-- `executado = false` e uma PROPOSTA (o agente sugeriu); `true` e uma
-- gravacao efetiva (o usuario confirmou). Guardar os dois lados e o que
-- permite auditar tanto o que o sistema fez quanto o que ele tentou fazer.
create table if not exists a2a_auditoria (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  context_id text,
  acao text not null,
  detalhes jsonb not null default '{}'::jsonb,
  executado boolean not null default false,
  criado_em timestamptz not null default timezone('utc'::text, now())
);

create index if not exists idx_a2a_auditoria_user on a2a_auditoria(user_id, criado_em desc);
create index if not exists idx_a2a_auditoria_executado on a2a_auditoria(user_id, executado, criado_em desc);

-- ---------------------------------------------------------------------------
-- Permissões (GRANT)
-- ---------------------------------------------------------------------------
-- Garante que service_role e authenticated possam ler e escrever nas tabelas.
-- Sem isto, o PostgREST responde "permission denied for table a2a_tarefas" (erro 42501).
grant all on table a2a_tarefas to authenticated, service_role;
grant all on table a2a_auditoria to authenticated, service_role;
grant all on sequence a2a_auditoria_id_seq to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- O backend acessa estas tabelas com a service role (que ignora RLS), mesmo
-- padrao do resto do projeto. As policies existem para o caso de algum
-- acesso passar a ser feito com o cliente anonimo: sem elas, uma mudanca
-- futura de cliente exporia conversa e auditoria de todo mundo.
alter table a2a_tarefas enable row level security;
alter table a2a_auditoria enable row level security;

drop policy if exists "a2a_tarefas_proprio_usuario" on a2a_tarefas;
create policy "a2a_tarefas_proprio_usuario" on a2a_tarefas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "a2a_auditoria_proprio_usuario" on a2a_auditoria;
create policy "a2a_auditoria_proprio_usuario" on a2a_auditoria
  for select using (auth.uid() = user_id);



-- ---------------------------------------------------------------------------
-- Backfill pendente (ver scripts/backfill_user_id_kanban.js)
-- ---------------------------------------------------------------------------
-- `kanban_cards.user_id` passou a ser preenchido nas escritas novas, mas as
-- linhas antigas continuam nulas e aparecem para todos os usuarios marcadas
-- como "sem dono". Atribua o dono correto e, depois que nao restar nenhuma
-- linha nula, este indice torna o filtro por usuario barato:
create index if not exists idx_kanban_cards_user on kanban_cards(user_id);
