-- ============================================================
-- SGC · Esquema para Supabase (PostgreSQL)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- ============================================================

-- Personal del establecimiento (usuarios del sistema)
create table if not exists staff (
  u       text primary key,
  n       text not null,
  role    text not null check (role in ('adm','enf','med','jef')),
  col     text,
  activo  boolean not null default true
);

-- Pacientes (una historia clínica por DNI)
create table if not exists patients (
  dni   text primary key check (dni ~ '^[0-9]{8}$'),
  nom   text not null,
  ape   text not null,
  nac   date,
  sexo  text check (sexo in ('F','M')),
  tel   text,
  sis   text not null check (sis in ('ACTIVO','NO_ASEGURADO','PENDIENTE_VALIDACION')),
  hc    text unique not null,
  ant   text,
  alg   text
);

-- Turnos. Columnas de consulta frecuente + detalle (triaje, consulta, tiempos) en jsonb.
create table if not exists turns (
  id     text primary key,
  dni    text not null references patients(dni),
  state  text not null check (state in (
           'EN_ESPERA_TRIAJE','LLAMADO_TRIAJE','EN_TRIAJE',
           'EN_ESPERA_CONSULTA','LLAMADO_CONSULTA','EN_CONSULTA',
           'ATENDIDO','CANCELADO')),
  prio   text check (prio in ('CRITICA','PRIORITARIA','NORMAL')),
  t0     bigint not null,          -- llegada (epoch en ms)
  data   jsonb not null default '{}'::jsonb
);
create index if not exists turns_state_idx on turns(state);
create index if not exists turns_dni_idx on turns(dni);

-- Umbrales clínicos versionados: la fila con mayor "since" es la vigente.
create table if not exists thresholds (
  id           text primary key,
  vals         jsonb not null,
  approved_by  text not null,
  since        bigint not null
);

-- Auditoría (RF-18)
create table if not exists audit_log (
  id  text primary key,
  t   bigint not null,
  u   text not null,
  a   text not null,
  d   text,
  ip  text
);
create index if not exists audit_t_idx on audit_log(t desc);

-- ------------------------------------------------------------
-- Permisos del Data API (OBLIGATORIO en proyectos creados desde el 30-may-2026:
-- Supabase ya no expone las tablas nuevas automáticamente; sin estos GRANT
-- la app recibe "permission denied for table ...").
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete
  on public.staff, public.patients, public.turns, public.thresholds, public.audit_log
  to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Seguridad: SOLO PARA EL PROTOTIPO.
-- Permite leer y escribir con la clave pública (anon).
-- En producción: Supabase Auth + políticas por rol.
-- ------------------------------------------------------------
alter table staff      enable row level security;
alter table patients   enable row level security;
alter table turns      enable row level security;
alter table thresholds enable row level security;
alter table audit_log  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['staff','patients','turns','thresholds','audit_log'] loop
    execute format('drop policy if exists "demo_all" on %I', t);
    execute format('create policy "demo_all" on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Tiempo real: la pantalla de sala y las demás PCs se actualizan solas.
do $$
declare t text;
begin
  foreach t in array array['staff','patients','turns','thresholds','audit_log'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
