-- Rodar manualmente no SQL Editor do Supabase (nao ha ferramenta de execucao
-- automatica de SQL neste projeto). Idempotente - seguro rodar mais de uma
-- vez (if not exists / or replace em tudo).
--
-- Depois de validado em producao, dobrar este conteudo para dentro de
-- schema.sql para paridade de instalacao do zero (mesmo tratamento ja dado
-- ao gap preexistente das tabelas `usuarios`/`setup_usuario`, que tambem
-- nao estao em schema.sql).

create extension if not exists vector;

alter table atividades   add column if not exists embedding vector(1536);
alter table kanban_cards add column if not exists embedding vector(1536);

-- HNSW em vez de IVFFLAT: as duas tabelas sao de escrita incremental e baixo
-- volume (atividades/tarefas de poucos usuarios, nao milhoes de linhas).
-- IVFFLAT precisa de um numero de "listas" calibrado no CREATE INDEX e o
-- recall degrada conforme a tabela cresce alem do que foi calibrado,
-- exigindo reindex manual periodico. HNSW nao depende do tamanho da tabela
-- no momento da criacao e tem recall melhor por padrao - o custo (build um
-- pouco mais lento, mais memoria) e irrelevante nesta escala.
create index if not exists idx_atividades_embedding
  on atividades using hnsw (embedding vector_cosine_ops);
create index if not exists idx_kanban_cards_embedding
  on kanban_cards using hnsw (embedding vector_cosine_ops);

-- NOTA: kanban_cards.user_id nunca e preenchido pelo codigo de aplicacao hoje
-- (gap preexistente em interface-adapters/mappers/KanbanPayloadMapper.js,
-- nao corrigido nesta migration - flagueado no plano de implementacao). Por
-- isso match_kanban_cards aceita match_user_id como opcional/nulo: a busca
-- semantica de kanban fica sem escopo por usuario ate esse gap ser fechado.

create or replace function match_atividades(
  query_embedding vector(1536),
  match_count int default 5,
  match_user_id uuid default null
)
returns table (
  id text, titulo text, atividade text, assunto_interno text,
  projeto text, semana text, similarity float
)
language sql stable as $$
  select a.id, a.titulo, a.atividade, a.assunto_interno, a.projeto, a.semana,
         1 - (a.embedding <=> query_embedding) as similarity
  from atividades a
  where a.embedding is not null
    and (match_user_id is null or a.user_id = match_user_id)
  order by a.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_kanban_cards(
  query_embedding vector(1536),
  match_count int default 5,
  match_user_id uuid default null
)
returns table (
  id text, titulo text, descricao text, assunto_interno text,
  projeto text, status text, similarity float
)
language sql stable as $$
  select k.id, k.titulo, k.descricao, k.assunto_interno, k.projeto, k.status,
         1 - (k.embedding <=> query_embedding) as similarity
  from kanban_cards k
  where k.embedding is not null
    and (match_user_id is null or k.user_id = match_user_id)
  order by k.embedding <=> query_embedding
  limit match_count;
$$;
