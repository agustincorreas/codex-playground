-- Clipper: esquema de base de datos (Supabase / Postgres)
-- Ejecutar completo en el SQL Editor de Supabase. Es idempotente.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Videos procesados (historial)
-- ---------------------------------------------------------------------------
create table if not exists videos (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  source_type     text not null check (source_type in ('youtube', 'drive', 'upload')),
  source_url      text,            -- link de YouTube o de Drive
  source_file_id  text,            -- id de archivo de Drive
  source_path     text,            -- ruta en Storage para subidas directas
  source_name     text,            -- nombre original del archivo
  title           text,
  duration_s      real,
  status          text not null default 'queued'
                  check (status in ('queued', 'downloading', 'transcribing', 'selecting', 'ready', 'error')),
  status_detail   text,
  error           text,
  topics          text,
  min_duration_s  integer not null default 60,
  max_duration_s  integer not null default 120,
  preset_id       text not null default 'natural',
  language        text,
  transcript      jsonb,           -- {"words": [{"t","s","e","spk"}], "provider", "language"}
  sentences       jsonb,           -- oraciones derivadas: [{"i","s","e","spk","text"}]
  candidates_count integer not null default 0
);

create index if not exists videos_created_at_idx on videos (created_at desc);

-- ---------------------------------------------------------------------------
-- Clips candidatos y renderizados
-- ---------------------------------------------------------------------------
create table if not exists clips (
  id               uuid primary key default gen_random_uuid(),
  video_id         uuid not null references videos (id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  position         integer not null default 0,     -- orden en la lista (por puntaje)
  start_s          real not null,
  end_s            real not null,
  orig_start_s     real not null,                  -- valores propuestos por el LLM
  orig_end_s       real not null,
  title            text not null default '',
  hook             text not null default '',
  score            integer not null default 0,
  reason           text not null default '',
  status           text not null default 'candidate'
                   check (status in ('candidate', 'queued', 'rendering', 'ready', 'error')),
  status_detail    text,
  error            text,
  preset_id        text,                           -- si es null usa el del video
  subtitles        jsonb,                          -- cues generados: [{"s","e","text"}]
  subtitle_edits   jsonb not null default '{}'::jsonb, -- {"<inicio del cue>": "texto editado"}
  preview_path     text,
  preview_offset_s real,                           -- segundo del video original en que arranca la vista previa
  thumb_path       text,
  render_path      text,
  render_bytes     bigint,
  drive_file_id    text,
  drive_url        text
);

create index if not exists clips_video_id_idx on clips (video_id, position);

-- ---------------------------------------------------------------------------
-- Cola de trabajos (la procesa el worker)
-- ---------------------------------------------------------------------------
create table if not exists jobs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  type        text not null check (type in ('process_video', 'render_clip', 'save_to_drive')),
  video_id    uuid references videos (id) on delete cascade,
  clip_id     uuid references clips (id) on delete cascade,
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  attempts    integer not null default 0,
  locked_at   timestamptz,
  finished_at timestamptz,
  error       text
);

create index if not exists jobs_queue_idx on jobs (status, created_at);

-- Reclama el siguiente trabajo pendiente de forma atómica (varios workers no
-- pueden tomar el mismo).
create or replace function claim_job() returns setof jobs
language sql volatile as $$
  update jobs
     set status = 'running', locked_at = now(), attempts = attempts + 1
   where id = (
     select id from jobs
      where status = 'queued'
      order by created_at
      for update skip locked
      limit 1
   )
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- Presets de estilo (editables desde la UI). Los de fábrica se cargan desde el
-- worker/web si no existen.
-- ---------------------------------------------------------------------------
create table if not exists presets (
  id          text primary key,
  name        text not null,
  builtin     boolean not null default false,
  config      jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Configuración (clave/valor): cookies.txt, tokens de Google, carpeta de Drive
-- ---------------------------------------------------------------------------
create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- updated_at automático
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists videos_updated_at on videos;
create trigger videos_updated_at before update on videos for each row execute function set_updated_at();
drop trigger if exists clips_updated_at on clips;
create trigger clips_updated_at before update on clips for each row execute function set_updated_at();
drop trigger if exists presets_updated_at on presets;
create trigger presets_updated_at before update on presets for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Storage: un bucket privado. Todo acceso va con la service key (server) o
-- con URLs firmadas, así que no hacen falta políticas públicas.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('clipper', 'clipper', false, null)
on conflict (id) do nothing;

-- RLS: la app y el worker usan la service role key, que saltea RLS. Se activa
-- RLS igual para que la anon key no pueda leer nada.
alter table videos   enable row level security;
alter table clips    enable row level security;
alter table jobs     enable row level security;
alter table presets  enable row level security;
alter table settings enable row level security;
