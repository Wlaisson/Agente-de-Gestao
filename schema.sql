create table if not exists opcoes_sistema (
  id text primary key,
  dados jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists kanban_cards (
  id text primary key,
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
