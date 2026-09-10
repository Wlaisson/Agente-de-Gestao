create table if not exists opcoes_sistema (
  id text primary key,
  dados jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists kanban_cards (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  titulo text not null,
  descricao text default '',
  projeto text default '',
  assunto_interno text default '',
  class_nivel_1 text default '',
  class_nivel_2 text default '',
  prioridade text default 'Média',
  status text default 'A Fazer',
  data_criacao text default '',
  prazo text default '',
  tempo text default '',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists atividades (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  data text not null,
  semana text not null,
  projeto text default '',
  assunto_interno text default '',
  titulo text default '',
  atividade text not null,
  tempo text default '00:00:00',
  class_nivel_1 text default '',
  class_nivel_2 text default '',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists idx_atividades_user_id on atividades(user_id);
create index if not exists idx_atividades_semana on atividades(semana);
