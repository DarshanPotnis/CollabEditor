create table if not exists projects (
  id          text primary key,
  name        text not null,
  template    text not null,
  ydoc        bytea,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
