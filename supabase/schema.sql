-- =====================================================================
-- SGC · Sistema web de gestión clínica (PMV) · Esquema para Supabase
-- Modelo de 13 entidades del informe (sección 2.5 y anexo A).
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar todo → Run.
-- Supabase avisará de "operaciones destructivas": es por los DROP del
-- inicio, que borran las tablas anteriores del prototipo (staff, patients,
-- turns, thresholds, audit_log) y reinstalan este esquema desde cero.
-- ATENCIÓN: ejecutarlo de nuevo BORRA TODOS LOS DATOS. La app vuelve a
-- cargar los datos de demostración en la siguiente apertura.
--
-- Diferencias con el modelo físico del informe (todas documentadas):
--   · TURNO agrega ts_ultimo_llamado, veces_llamado e id_usuario_en_atencion
--     (los usa la pantalla de sala y el control de quién atiende).
--   · AUDITORIA.operacion admite también LOGOUT.
--   · DETALLE_RECETA.cantidad_solicitada es opcional (el médico puede omitirla).
--   · La app no escribe directamente en las tablas: usa las funciones
--     sgc_guardar, sgc_cargar y sgc_restablecer (una transacción por acción).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Limpieza (versión anterior del prototipo y reinstalación)
-- ---------------------------------------------------------------------
drop table if exists public.audit_log, public.turns, public.thresholds,
                     public.patients, public.staff cascade;

drop function if exists public.sgc_cargar();
drop function if exists public.sgc_guardar(jsonb);
drop function if exists public.sgc_restablecer();
drop schema if exists sgc_interno cascade;

drop table if exists public.auditoria, public.umbral_clinico, public.detalle_receta,
                     public.receta_medica, public.atencion_diagnostico, public.diagnostico_cie10,
                     public.atencion_medica, public.signos_vitales, public.turno,
                     public.historia_clinica, public.area_atencion, public.usuario,
                     public.paciente cascade;

create extension if not exists pgcrypto;   -- crypt() para password_hash

-- ---------------------------------------------------------------------
-- 1. PACIENTE
-- ---------------------------------------------------------------------
create table public.paciente (
    id_paciente          uuid         not null default gen_random_uuid(),
    tipo_documento       varchar(10)  not null default 'DNI',
    numero_documento     varchar(15)  not null,
    nombres              varchar(100) not null,
    apellidos            varchar(100) not null,
    fecha_nacimiento     date         not null,
    sexo                 char(1)      not null,
    telefono             varchar(15)  null,
    condicion_sis        varchar(25)  not null default 'PENDIENTE_VALIDACION',
    fecha_validacion_sis timestamptz  null,
    creado_en            timestamptz  not null default now(),
    constraint pk_paciente primary key (id_paciente),
    constraint uq_paciente_documento unique (tipo_documento, numero_documento),
    constraint ck_paciente_tipo_doc check (tipo_documento in ('DNI','CE','PASAPORTE','OTRO')),
    constraint ck_paciente_dni check (tipo_documento <> 'DNI' or numero_documento ~ '^[0-9]{8}$'),
    constraint ck_paciente_nombres check (length(trim(nombres)) > 0 and length(trim(apellidos)) > 0),
    constraint ck_paciente_nacimiento check (fecha_nacimiento <= current_date),
    constraint ck_paciente_sexo check (sexo in ('M','F')),
    constraint ck_paciente_sis check (condicion_sis in ('ACTIVO','NO_ASEGURADO','PENDIENTE_VALIDACION'))
);

-- ---------------------------------------------------------------------
-- 2. USUARIO
-- ---------------------------------------------------------------------
create table public.usuario (
    id_usuario       uuid         not null default gen_random_uuid(),
    username         varchar(50)  not null,
    password_hash    varchar(255) not null,
    rol              varchar(15)  not null,
    nombre_completo  varchar(150) not null,
    colegiatura      varchar(15)  null,
    activo           boolean      not null default true,
    creado_en        timestamptz  not null default now(),
    constraint pk_usuario primary key (id_usuario),
    constraint uq_usuario_username unique (username),
    constraint ck_usuario_rol check (rol in ('ADMISION','ENFERMERIA','MEDICO','JEFATURA')),
    constraint ck_usuario_colegiatura check (rol <> 'MEDICO' or colegiatura is not null)
);

-- ---------------------------------------------------------------------
-- 3. AREA_ATENCION
-- ---------------------------------------------------------------------
create table public.area_atencion (
    id_area  uuid        not null default gen_random_uuid(),
    nombre   varchar(60) not null,
    tipo     varchar(12) not null,
    activo   boolean     not null default true,
    constraint pk_area_atencion primary key (id_area),
    constraint uq_area_nombre unique (nombre),
    constraint ck_area_tipo check (tipo in ('TRIAJE','CONSULTORIO'))
);

-- ---------------------------------------------------------------------
-- 4. HISTORIA_CLINICA (1:1 con PACIENTE)
-- ---------------------------------------------------------------------
create table public.historia_clinica (
    id_historia               uuid        not null default gen_random_uuid(),
    id_paciente               uuid        not null,
    numero_historia           varchar(20) not null,
    antecedentes_patologicos  text        null,
    alergias_medicamentosas   text        null,
    fecha_apertura            timestamptz not null default now(),
    constraint pk_historia_clinica primary key (id_historia),
    constraint uq_historia_paciente unique (id_paciente),
    constraint uq_historia_numero unique (numero_historia),
    constraint fk_historia_paciente foreign key (id_paciente)
        references public.paciente (id_paciente) on delete restrict on update cascade
);

-- ---------------------------------------------------------------------
-- 5. TURNO
-- ---------------------------------------------------------------------
create table public.turno (
    id_turno               uuid         not null default gen_random_uuid(),
    fecha_turno            date         not null default current_date,
    codigo_turno           varchar(10)  not null,
    id_paciente            uuid         not null,
    id_usuario_admision    uuid         not null,
    id_area_destino        uuid         null,
    estado                 varchar(20)  not null default 'EN_ESPERA_TRIAJE',
    nivel_prioridad        varchar(12)  not null default 'NORMAL',
    hora_llegada           timestamptz  not null default now(),
    ts_inicio_triaje       timestamptz  null,
    ts_fin_triaje          timestamptz  null,
    ts_llamado_consulta    timestamptz  null,
    ts_cierre              timestamptz  null,
    motivo_cancelacion     varchar(100) null,
    -- columnas operativas del PMV (no están en el modelo del informe)
    ts_ultimo_llamado      timestamptz  null,
    veces_llamado          smallint     not null default 0,
    id_usuario_en_atencion uuid         null,
    constraint pk_turno primary key (id_turno),
    constraint uq_turno_codigo_dia unique (fecha_turno, codigo_turno),
    constraint ck_turno_estado check (estado in ('EN_ESPERA_TRIAJE','EN_TRIAJE','EN_ESPERA_CONSULTA',
                                                 'LLAMANDO','EN_CONSULTA','ATENDIDO','CANCELADO')),
    constraint ck_turno_prioridad check (nivel_prioridad in ('NORMAL','PRIORITARIA','CRITICA')),
    constraint ck_turno_secuencia check (
        (ts_fin_triaje is null or ts_inicio_triaje is null or ts_fin_triaje >= ts_inicio_triaje) and
        (ts_cierre     is null or ts_cierre >= hora_llegada)),
    constraint ck_turno_llamados check (veces_llamado >= 0),
    constraint fk_turno_paciente foreign key (id_paciente)
        references public.paciente (id_paciente) on delete restrict on update cascade,
    constraint fk_turno_usuario foreign key (id_usuario_admision)
        references public.usuario (id_usuario) on delete restrict on update cascade,
    constraint fk_turno_area foreign key (id_area_destino)
        references public.area_atencion (id_area) on delete restrict on update cascade,
    constraint fk_turno_en_atencion foreign key (id_usuario_en_atencion)
        references public.usuario (id_usuario) on delete restrict on update cascade
);
create index ix_turno_cola on public.turno (estado, nivel_prioridad, hora_llegada);
create index ix_turno_paciente on public.turno (id_paciente);
create index ix_turno_codigo on public.turno (codigo_turno);
-- Un paciente no puede tener dos turnos activos el mismo día
create unique index uq_turno_activo_paciente on public.turno (id_paciente, fecha_turno)
    where estado not in ('ATENDIDO','CANCELADO');
-- Un consultorio atiende a un solo paciente a la vez; el módulo de triaje también
create unique index uq_turno_consultorio_ocupado on public.turno (id_area_destino)
    where estado = 'EN_CONSULTA';
create unique index uq_turno_triaje_ocupado on public.turno (estado)
    where estado = 'EN_TRIAJE';

-- ---------------------------------------------------------------------
-- 6. SIGNOS_VITALES (1:1 con TURNO)
-- ---------------------------------------------------------------------
create table public.signos_vitales (
    id_signos             uuid         not null default gen_random_uuid(),
    id_turno              uuid         not null,
    id_usuario_enfermero  uuid         not null,
    presion_sistolica     smallint     not null,
    presion_diastolica    smallint     not null,
    pulso                 smallint     not null,
    frecuencia_resp       smallint     not null,
    temperatura           decimal(3,1) not null,
    saturacion_spo2       decimal(4,1) not null,
    peso_kg               decimal(5,2) not null,
    talla_m               decimal(3,2) not null,
    imc                   decimal(4,2) generated always as (round(peso_kg / (talla_m * talla_m), 2)) stored,
    motivo_triaje         varchar(255) not null,
    alerta_critica        boolean      not null default false,
    fecha_toma            timestamptz  not null default now(),
    constraint pk_signos_vitales primary key (id_signos),
    constraint uq_signos_turno unique (id_turno),
    constraint ck_sv_pas  check (presion_sistolica  between 50 and 260),
    constraint ck_sv_pad  check (presion_diastolica between 30 and 160),
    constraint ck_sv_fc   check (pulso between 20 and 250),
    constraint ck_sv_fr   check (frecuencia_resp between 4 and 80),
    constraint ck_sv_temp check (temperatura between 30.0 and 45.0),
    constraint ck_sv_spo2 check (saturacion_spo2 between 50.0 and 100.0),
    constraint ck_sv_peso check (peso_kg between 0.5 and 350),
    constraint ck_sv_talla check (talla_m between 0.30 and 2.50),
    constraint fk_signos_turno foreign key (id_turno)
        references public.turno (id_turno) on delete restrict on update cascade,
    constraint fk_signos_enfermero foreign key (id_usuario_enfermero)
        references public.usuario (id_usuario) on delete restrict on update cascade
);

-- ---------------------------------------------------------------------
-- 7. ATENCION_MEDICA (1:1 con TURNO)
-- ---------------------------------------------------------------------
create table public.atencion_medica (
    id_atencion        uuid         not null default gen_random_uuid(),
    id_turno           uuid         not null,
    id_historia        uuid         not null,
    id_usuario_medico  uuid         not null,
    id_area            uuid         not null,
    motivo_consulta    text         not null,
    examen_clinico     text         not null,
    destino_alta       varchar(20)  not null,
    detalle_destino    varchar(150) null,
    fecha_atencion     timestamptz  not null default now(),
    constraint pk_atencion_medica primary key (id_atencion),
    constraint uq_atencion_turno unique (id_turno),
    constraint ck_atencion_destino check (destino_alta in ('ALTA','REPOSO','DERIVACION_HOSPITAL')),
    constraint fk_atencion_turno foreign key (id_turno)
        references public.turno (id_turno) on delete restrict on update cascade,
    constraint fk_atencion_historia foreign key (id_historia)
        references public.historia_clinica (id_historia) on delete restrict on update cascade,
    constraint fk_atencion_medico foreign key (id_usuario_medico)
        references public.usuario (id_usuario) on delete restrict on update cascade,
    constraint fk_atencion_area foreign key (id_area)
        references public.area_atencion (id_area) on delete restrict on update cascade
);
create index ix_atencion_historia on public.atencion_medica (id_historia, fecha_atencion);

-- ---------------------------------------------------------------------
-- 8. DIAGNOSTICO_CIE10 (catálogo)
-- ---------------------------------------------------------------------
create table public.diagnostico_cie10 (
    codigo_cie10  varchar(10)  not null,
    descripcion   varchar(255) not null,
    constraint pk_diagnostico_cie10 primary key (codigo_cie10)
);

-- ---------------------------------------------------------------------
-- 9. ATENCION_DIAGNOSTICO (N:M entre ATENCION_MEDICA y DIAGNOSTICO_CIE10)
-- ---------------------------------------------------------------------
create table public.atencion_diagnostico (
    id_atencion_diag  uuid        not null default gen_random_uuid(),
    id_atencion       uuid        not null,
    codigo_cie10      varchar(10) not null,
    tipo_diagnostico  varchar(12) not null default 'PRESUNTIVO',
    constraint pk_atencion_diagnostico primary key (id_atencion_diag),
    constraint uq_atencion_diag unique (id_atencion, codigo_cie10),
    constraint ck_atdiag_tipo check (tipo_diagnostico in ('PRESUNTIVO','DEFINITIVO')),
    constraint fk_atdiag_atencion foreign key (id_atencion)
        references public.atencion_medica (id_atencion) on delete restrict on update cascade,
    constraint fk_atdiag_cie10 foreign key (codigo_cie10)
        references public.diagnostico_cie10 (codigo_cie10) on delete restrict on update cascade
);

-- ---------------------------------------------------------------------
-- 10. RECETA_MEDICA (1:0..1 con ATENCION_MEDICA)
-- ---------------------------------------------------------------------
create table public.receta_medica (
    id_receta      uuid        not null default gen_random_uuid(),
    id_atencion    uuid        not null,
    codigo_receta  varchar(25) not null,
    fecha_emision  timestamptz not null default now(),
    observaciones  text        null,
    constraint pk_receta_medica primary key (id_receta),
    constraint uq_receta_atencion unique (id_atencion),
    constraint uq_receta_codigo unique (codigo_receta),
    constraint ck_receta_codigo check (codigo_receta ~ '^REC-[0-9]{4}-[0-9]{6}$'),
    constraint fk_receta_atencion foreign key (id_atencion)
        references public.atencion_medica (id_atencion) on delete restrict on update cascade
);

-- ---------------------------------------------------------------------
-- 11. DETALLE_RECETA
-- ---------------------------------------------------------------------
create table public.detalle_receta (
    id_detalle           uuid         not null default gen_random_uuid(),
    id_receta            uuid         not null,
    medicamento          varchar(120) not null,
    concentracion        varchar(50)  not null,
    dosis                varchar(60)  not null,
    frecuencia           varchar(60)  not null,
    duracion_dias        smallint     not null,
    cantidad_solicitada  smallint     null,
    constraint pk_detalle_receta primary key (id_detalle),
    constraint ck_detalle_duracion check (duracion_dias > 0),
    constraint ck_detalle_cantidad check (cantidad_solicitada is null or cantidad_solicitada > 0),
    constraint fk_detalle_receta foreign key (id_receta)
        references public.receta_medica (id_receta) on delete restrict on update cascade
);

-- ---------------------------------------------------------------------
-- 12. UMBRAL_CLINICO (umbrales de triaje aprobados por un médico)
--     CRITICO -> prioridad CRITICA ; ALERTA -> prioridad PRIORITARIA
-- ---------------------------------------------------------------------
create table public.umbral_clinico (
    id_umbral             uuid         not null default gen_random_uuid(),
    parametro             varchar(20)  not null,
    nivel                 varchar(8)   not null default 'CRITICO',
    operador              varchar(2)   not null,
    valor_umbral          decimal(6,2) not null,
    id_usuario_aprobador  uuid         not null,
    vigente_desde         timestamptz  not null default now(),
    vigente_hasta         timestamptz  null,
    constraint pk_umbral_clinico primary key (id_umbral),
    constraint ck_umbral_parametro check (parametro in ('SPO2','TEMPERATURA','PAS','PULSO_MAX',
                                                        'PULSO_MIN','FR_MAX','FR_MIN')),
    constraint ck_umbral_nivel check (nivel in ('CRITICO','ALERTA')),
    constraint ck_umbral_operador check (operador in ('<','<=','>','>=')),
    constraint ck_umbral_vigencia check (vigente_hasta is null or vigente_hasta > vigente_desde),
    constraint fk_umbral_aprobador foreign key (id_usuario_aprobador)
        references public.usuario (id_usuario) on delete restrict on update cascade
);
-- Solo un umbral vigente por parámetro y nivel
create unique index uq_umbral_vigente on public.umbral_clinico (parametro, nivel) where vigente_hasta is null;

-- ---------------------------------------------------------------------
-- 13. AUDITORIA
-- ---------------------------------------------------------------------
create table public.auditoria (
    id_auditoria        uuid        not null default gen_random_uuid(),
    id_usuario          uuid        not null,
    tabla_afectada      varchar(60) not null,
    id_registro         varchar(40) null,
    operacion           varchar(10) not null,
    valores_anteriores  jsonb       null,
    valores_nuevos      jsonb       null,
    direccion_ip        inet        not null,
    fecha_hora          timestamptz not null default now(),
    constraint pk_auditoria primary key (id_auditoria),
    constraint ck_auditoria_operacion check (operacion in ('INSERT','UPDATE','DELETE','SELECT','LOGIN','LOGOUT')),
    constraint fk_auditoria_usuario foreign key (id_usuario)
        references public.usuario (id_usuario) on delete restrict on update cascade
);
create index ix_auditoria_usuario_fecha on public.auditoria (id_usuario, fecha_hora);
create index ix_auditoria_tabla_fecha on public.auditoria (tabla_afectada, fecha_hora);
create index ix_auditoria_fecha on public.auditoria (fecha_hora desc);

-- ---------------------------------------------------------------------
-- Catálogos iniciales
-- ---------------------------------------------------------------------
insert into public.area_atencion (nombre, tipo) values
  ('Módulo de Triaje 1', 'TRIAJE'),
  ('Consultorio 1', 'CONSULTORIO'),
  ('Consultorio 2', 'CONSULTORIO');

insert into public.diagnostico_cie10 (codigo_cie10, descripcion) values
  ('J00',   'Rinofaringitis aguda (resfriado común)'),
  ('J06.9', 'Infección aguda de vías respiratorias superiores, no especificada'),
  ('J10.1', 'Influenza con otras manifestaciones respiratorias (gripe)'),
  ('J20.9', 'Bronquitis aguda, no especificada'),
  ('J18.9', 'Neumonía, no especificada'),
  ('J45.9', 'Asma, no especificada'),
  ('I10',   'Hipertensión esencial (primaria)'),
  ('E11.9', 'Diabetes mellitus tipo 2, sin complicaciones'),
  ('K29.7', 'Gastritis, no especificada'),
  ('N39.0', 'Infección de vías urinarias, sitio no especificado'),
  ('A09',   'Diarrea y gastroenteritis de presunto origen infeccioso'),
  ('R51',   'Cefalea'),
  ('M54.5', 'Lumbago (dolor lumbar bajo)'),
  ('B34.9', 'Infección viral, no especificada'),
  ('R50.9', 'Fiebre, no especificada');

-- =====================================================================
-- Funciones auxiliares (esquema interno, no expuesto por la API)
-- =====================================================================
create schema sgc_interno;

-- Milisegundos desde 1970 (formato de la app) <-> timestamptz, sin pérdida
create function sgc_interno.ts(ms bigint) returns timestamptz
language sql immutable set search_path = '' as $$ select case when ms is null then null
  else timestamptz 'epoch' + ms * interval '1 millisecond' end $$;

create function sgc_interno.ms(t timestamptz) returns bigint
language sql immutable set search_path = '' as $$ select round(extract(epoch from t) * 1000)::bigint $$;

create function sgc_interno.id_usuario(p_username text) returns uuid
language sql stable set search_path = '' as $$ select id_usuario from public.usuario where username = p_username $$;

create function sgc_interno.id_area(p_nombre text) returns uuid
language plpgsql set search_path = '' as $$
declare v uuid;
begin
  if p_nombre is null or p_nombre = '' then return null; end if;
  select id_area into v from public.area_atencion where nombre = p_nombre;
  if v is null then
    insert into public.area_atencion (nombre, tipo)
    values (p_nombre, case when p_nombre ilike '%triaje%' then 'TRIAJE' else 'CONSULTORIO' end)
    returning id_area into v;
  end if;
  return v;
end $$;

-- Estado tal como lo usa la app: LLAMANDO se distingue por si ya hubo triaje
create function sgc_interno.estado_app(p_estado text, p_fin_triaje timestamptz) returns text
language sql immutable set search_path = '' as $$
  select case when p_estado = 'LLAMANDO'
              then case when p_fin_triaje is null then 'LLAMADO_TRIAJE' else 'LLAMADO_CONSULTA' end
              else p_estado end $$;

-- Máquina de estados del turno (la misma de src/lib/clinical.js)
create function sgc_interno.transicion_valida(p_desde text, p_hacia text) returns boolean
language sql immutable set search_path = '' as $$
  select p_desde = p_hacia or (p_desde, p_hacia) in (
    ('EN_ESPERA_TRIAJE','LLAMADO_TRIAJE'),   ('EN_ESPERA_TRIAJE','CANCELADO'),
    ('LLAMADO_TRIAJE','EN_TRIAJE'),          ('LLAMADO_TRIAJE','CANCELADO'),
    ('EN_TRIAJE','EN_ESPERA_CONSULTA'),      ('EN_TRIAJE','EN_ESPERA_TRIAJE'),
    ('EN_ESPERA_CONSULTA','LLAMADO_CONSULTA'), ('EN_ESPERA_CONSULTA','CANCELADO'),
    ('LLAMADO_CONSULTA','EN_CONSULTA'),      ('LLAMADO_CONSULTA','CANCELADO'),
    ('EN_CONSULTA','ATENDIDO'),              ('EN_CONSULTA','EN_ESPERA_CONSULTA')) $$;

-- Umbrales: clave de la app -> (parámetro, nivel, operador)
create function sgc_interno.mapa_umbral() returns table (clave text, parametro text, nivel text, operador text)
language sql immutable set search_path = '' as $$
  values ('spo2','SPO2','CRITICO','<'),          ('spo2A','SPO2','ALERTA','<='),
         ('tmp','TEMPERATURA','CRITICO','>='),   ('tmpA','TEMPERATURA','ALERTA','>='),
         ('pasLo','PAS','CRITICO','<'),          ('pasA','PAS','ALERTA','>='),
         ('fcHi','PULSO_MAX','CRITICO','>'),     ('fcA','PULSO_MAX','ALERTA','>'),
         ('frHi','FR_MAX','CRITICO','>'),        ('frA','FR_MAX','ALERTA','>=') $$;

-- Acción de la app -> (tabla afectada, operación) para AUDITORIA
create function sgc_interno.accion_auditoria(p_accion text, p_detalle text, out tabla text, out operacion text)
language sql immutable set search_path = '' as $$
  select case p_accion
           when 'LOGIN' then 'usuario'             when 'LOGOUT' then 'usuario'
           when 'USUARIO' then 'usuario'           when 'RESET_CLAVE' then 'usuario'
           when 'AREA' then 'area_atencion'
           when 'BUSQUEDA_DNI' then 'paciente'     when 'PACIENTE_NUEVO' then 'paciente'
           when 'ALERGIAS' then 'historia_clinica' when 'HC_CONSULTADA' then 'historia_clinica'
           when 'TRIAJE_GUARDADO' then 'signos_vitales'
           when 'ATENCION_FINALIZADA' then 'atencion_medica'
           when 'ALERGIA_CONFIRMADA' then 'receta_medica'
           when 'UMBRALES' then 'umbral_clinico'
           else 'turno' end,
         case when p_accion in ('LOGIN','LOGOUT') then p_accion
              when p_accion in ('BUSQUEDA_DNI','HC_CONSULTADA','AREA') then 'SELECT'
              when p_accion in ('PACIENTE_NUEVO','TURNO_CREADO','TRIAJE_GUARDADO','ATENCION_FINALIZADA',
                                'ALERGIA_CONFIRMADA','UMBRALES') then 'INSERT'
              when p_accion = 'USUARIO' and p_detalle like '% creado%' then 'INSERT'
              else 'UPDATE' end $$;

-- =====================================================================
-- API para la app (Supabase la expone como /rest/v1/rpc/...)
-- =====================================================================

-- ---------------------------------------------------------------------
-- sgc_cargar(): devuelve toda la base en el formato de la app
-- ---------------------------------------------------------------------
create function public.sgc_cargar() returns jsonb
language sql stable security definer set search_path = public, sgc_interno as $$
select jsonb_build_object(
  'users', coalesce((
    select jsonb_agg(jsonb_build_object(
      'u', u.username, 'n', u.nombre_completo,
      'role', case u.rol when 'ADMISION' then 'adm' when 'ENFERMERIA' then 'enf'
                         when 'MEDICO' then 'med' else 'jef' end,
      'col', coalesce(u.colegiatura, ''), 'on', u.activo) order by u.creado_en, u.username)
    from usuario u), '[]'::jsonb),

  'patients', coalesce((
    select jsonb_agg(jsonb_build_object(
      'dni', p.numero_documento, 'nom', p.nombres, 'ape', p.apellidos,
      'nac', to_char(p.fecha_nacimiento, 'YYYY-MM-DD'), 'sexo', p.sexo,
      'tel', coalesce(p.telefono, ''), 'sis', p.condicion_sis, 'hc', h.numero_historia,
      'ant', coalesce(h.antecedentes_patologicos, ''), 'alg', coalesce(h.alergias_medicamentosas, ''))
      order by h.numero_historia)
    from paciente p join historia_clinica h on h.id_paciente = p.id_paciente), '[]'::jsonb),

  'turns', coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', t.codigo_turno, 'dni', p.numero_documento, 'adm', ua.username,
      'state', estado_app(t.estado, t.ts_fin_triaje),
      'prio', case when t.ts_fin_triaje is null then null else t.nivel_prioridad end,
      't0', ms(t.hora_llegada), 'tTriCall', ms(t.ts_inicio_triaje), 'tTriSave', ms(t.ts_fin_triaje),
      'tMedCall', ms(t.ts_llamado_consulta),
      'tEnd', case when t.estado = 'ATENDIDO' then ms(t.ts_cierre) end,
      'calledAt', ms(t.ts_ultimo_llamado),
      'calls', nullif(t.veces_llamado, 0),
      'dest', ar.nombre,
      'enf', coalesce(ue.username, case when t.estado = 'EN_TRIAJE' then uat.username end),
      'med', coalesce(um.username, case when t.estado = 'EN_CONSULTA' then uat.username end),
      'cancel', case when t.estado = 'CANCELADO' then jsonb_build_object(
                  'motivo', t.motivo_cancelacion, 't', ms(t.ts_cierre)) end,
      'tri', case when sv.id_signos is not null then jsonb_build_object(
                'pa', sv.presion_sistolica || '/' || sv.presion_diastolica,
                'fc', sv.pulso, 'fr', sv.frecuencia_resp, 't', sv.temperatura,
                'spo2', sv.saturacion_spo2, 'peso', sv.peso_kg, 'talla', sv.talla_m,
                'motivo', sv.motivo_triaje) end,
      'consult', case when am.id_atencion is not null then jsonb_build_object(
                'notas', am.examen_clinico,
                'dx', coalesce((select jsonb_agg(jsonb_build_array(d.codigo_cie10, c.descripcion,
                                  case d.tipo_diagnostico when 'DEFINITIVO' then 'D' else 'P' end)
                                  order by d.tipo_diagnostico, d.codigo_cie10)
                                from atencion_diagnostico d join diagnostico_cie10 c using (codigo_cie10)
                                where d.id_atencion = am.id_atencion), '[]'::jsonb),
                'meds', coalesce((select jsonb_agg(jsonb_build_object(
                                  'n', dr.medicamento, 'dosis', dr.dosis, 'frec', dr.frecuencia,
                                  'dias', dr.duracion_dias,
                                  'cant', coalesce(dr.cantidad_solicitada::text, ''))
                                  order by dr.medicamento)
                                from detalle_receta dr where dr.id_receta = rm.id_receta), '[]'::jsonb),
                'dest', case am.destino_alta when 'ALTA' then 'Alta' when 'REPOSO' then 'Reposo médico'
                                             else 'Derivación a hospital' end,
                'destx', coalesce(am.detalle_destino, ''),
                'rec', rm.codigo_receta,
                't', ms(am.fecha_atencion),
                'area', aa.nombre,
                'medico', jsonb_build_object('u', um.username, 'n', um.nombre_completo,
                                             'col', coalesce(um.colegiatura, ''))) end
    )) order by t.hora_llegada)
    from turno t
    join paciente p on p.id_paciente = t.id_paciente
    join usuario ua on ua.id_usuario = t.id_usuario_admision
    left join area_atencion ar on ar.id_area = t.id_area_destino
    left join usuario uat on uat.id_usuario = t.id_usuario_en_atencion
    left join signos_vitales sv on sv.id_turno = t.id_turno
    left join usuario ue on ue.id_usuario = sv.id_usuario_enfermero
    left join atencion_medica am on am.id_turno = t.id_turno
    left join usuario um on um.id_usuario = am.id_usuario_medico
    left join area_atencion aa on aa.id_area = am.id_area
    left join receta_medica rm on rm.id_atencion = am.id_atencion), '[]'::jsonb),

  'audit', coalesce((
    select jsonb_agg(x.o order by x.f desc) from (
      select a.fecha_hora f, jsonb_build_object(
        'id', a.id_auditoria, 't', ms(a.fecha_hora), 'u', u.username,
        'a', coalesce(a.valores_nuevos->>'accion', a.operacion),
        'd', coalesce(a.valores_nuevos->>'detalle', a.tabla_afectada),
        'ip', host(a.direccion_ip)) o
      from auditoria a join usuario u on u.id_usuario = a.id_usuario
      order by a.fecha_hora desc limit 500) x), '[]'::jsonb),

  'thresholds', coalesce((
    select jsonb_agg(jsonb_build_object('id', 'umb-' || ms(v.desde), 'vals', v.vals,
                                        'by', v.por, 'since', ms(v.desde)) order by v.desde)
    from (select uc.vigente_desde desde,
                 jsonb_object_agg(m.clave, uc.valor_umbral) vals,
                 min(u.nombre_completo) por
          from umbral_clinico uc
          join mapa_umbral() m on m.parametro = uc.parametro and m.nivel = uc.nivel
          join usuario u on u.id_usuario = uc.id_usuario_aprobador
          group by uc.vigente_desde) v), '[]'::jsonb)
);
$$;

-- ---------------------------------------------------------------------
-- sgc_guardar(cambios): guarda los cambios de una acción en una transacción.
-- cambios = { users:[], patients:[], thresholds:[], turns:[], audit:[] }
-- ---------------------------------------------------------------------
create function public.sgc_guardar(cambios jsonb) returns void
language plpgsql security definer set search_path = public, sgc_interno, extensions as $$
declare
  r jsonb; m jsonb; d jsonb;
  v_pac uuid; v_hist uuid; v_turno uuid; v_pac_actual uuid; v_estado_actual text;
  v_estado text; v_atencion uuid; v_receta uuid; v_usr uuid; v_aprob uuid; v_desde timestamptz;
  v_tabla text; v_oper text; v_pa text[];
begin
  -- Usuarios ------------------------------------------------------------
  for r in select * from jsonb_array_elements(coalesce(cambios->'users', '[]')) loop
    insert into usuario (username, password_hash, rol, nombre_completo, colegiatura, activo)
    values (r->>'u', crypt('demo1234', gen_salt('bf')),
            case r->>'role' when 'adm' then 'ADMISION' when 'enf' then 'ENFERMERIA'
                            when 'med' then 'MEDICO' else 'JEFATURA' end,
            r->>'n', nullif(r->>'col', ''), coalesce((r->>'on')::boolean, true))
    on conflict (username) do update
      set rol = excluded.rol, nombre_completo = excluded.nombre_completo,
          colegiatura = excluded.colegiatura, activo = excluded.activo;
  end loop;

  -- Pacientes e historia clínica ----------------------------------------
  for r in select * from jsonb_array_elements(coalesce(cambios->'patients', '[]')) loop
    insert into paciente (tipo_documento, numero_documento, nombres, apellidos,
                          fecha_nacimiento, sexo, telefono, condicion_sis)
    values ('DNI', r->>'dni', r->>'nom', r->>'ape', (r->>'nac')::date, r->>'sexo',
            nullif(r->>'tel', ''), r->>'sis')
    on conflict (tipo_documento, numero_documento) do update
      set nombres = excluded.nombres, apellidos = excluded.apellidos,
          fecha_nacimiento = excluded.fecha_nacimiento, sexo = excluded.sexo,
          telefono = excluded.telefono, condicion_sis = excluded.condicion_sis
    returning id_paciente into v_pac;

    insert into historia_clinica (id_paciente, numero_historia, antecedentes_patologicos, alergias_medicamentosas)
    values (v_pac, r->>'hc', nullif(r->>'ant', ''), nullif(r->>'alg', ''))
    on conflict (id_paciente) do update
      set antecedentes_patologicos = excluded.antecedentes_patologicos,
          alergias_medicamentosas = excluded.alergias_medicamentosas;
  end loop;

  -- Umbrales: cada elemento es una versión completa --------------------
  for r in select * from jsonb_array_elements(coalesce(cambios->'thresholds', '[]')) loop
    v_desde := ts((r->>'since')::bigint);
    continue when exists (select 1 from umbral_clinico where vigente_desde = v_desde);
    select id_usuario into v_aprob from usuario
      where nombre_completo = r->>'by' and rol = 'MEDICO' order by activo desc limit 1;
    if v_aprob is null then
      raise exception 'El aprobador de los umbrales debe ser un médico registrado (%).', r->>'by'
        using errcode = 'P0001';
    end if;
    update umbral_clinico set vigente_hasta = v_desde
      where vigente_hasta is null and vigente_desde < v_desde;
    insert into umbral_clinico (parametro, nivel, operador, valor_umbral, id_usuario_aprobador, vigente_desde)
    select m2.parametro, m2.nivel, m2.operador, (r->'vals'->>m2.clave)::numeric, v_aprob, v_desde
    from mapa_umbral() m2 where r->'vals' ? m2.clave;
  end loop;

  -- Turnos, triaje y atención -------------------------------------------
  for r in select * from jsonb_array_elements(coalesce(cambios->'turns', '[]')) loop
    select p.id_paciente, h.id_historia into v_pac, v_hist
      from paciente p join historia_clinica h using (id_paciente)
      where p.tipo_documento = 'DNI' and p.numero_documento = r->>'dni';
    if v_pac is null then
      raise exception 'El paciente con DNI % no está registrado.', r->>'dni' using errcode = 'P0001';
    end if;

    v_estado := case when r->>'state' in ('LLAMADO_TRIAJE','LLAMADO_CONSULTA') then 'LLAMANDO' else r->>'state' end;

    select id_turno, id_paciente, estado_app(estado, ts_fin_triaje)
      into v_turno, v_pac_actual, v_estado_actual
      from turno where codigo_turno = r->>'id' order by fecha_turno desc limit 1 for update;

    if v_turno is null then
      v_usr := id_usuario(r->>'adm');
      if v_usr is null then
        raise exception 'Falta el usuario de admisión del turno %.', r->>'id' using errcode = 'P0001';
      end if;
      insert into turno (fecha_turno, codigo_turno, id_paciente, id_usuario_admision, hora_llegada, estado)
      values ((ts((r->>'t0')::bigint) at time zone 'America/Lima')::date, r->>'id', v_pac, v_usr,
              ts((r->>'t0')::bigint), v_estado)
      returning id_turno into v_turno;
    else
      if v_pac_actual <> v_pac then
        raise exception 'El código % ya se asignó a otro paciente. Actualice la página e intente de nuevo.', r->>'id'
          using errcode = 'P0001';
      end if;
      if not transicion_valida(v_estado_actual, r->>'state') then
        raise exception 'El turno % cambió de estado en otra estación (%). Actualice la lista.', r->>'id', v_estado_actual
          using errcode = 'P0001';
      end if;
    end if;

    update turno set
      estado                 = v_estado,
      nivel_prioridad        = coalesce(r->>'prio', 'NORMAL'),
      id_area_destino        = id_area(r->>'dest'),
      ts_inicio_triaje       = ts((r->>'tTriCall')::bigint),
      ts_fin_triaje          = ts((r->>'tTriSave')::bigint),
      ts_llamado_consulta    = ts((r->>'tMedCall')::bigint),
      ts_cierre              = case when r->>'state' = 'CANCELADO' then ts((r->'cancel'->>'t')::bigint)
                                    else ts((r->>'tEnd')::bigint) end,
      motivo_cancelacion     = left(r->'cancel'->>'motivo', 100),
      ts_ultimo_llamado      = ts((r->>'calledAt')::bigint),
      veces_llamado          = coalesce((r->>'calls')::int, 0),
      id_usuario_en_atencion = case r->>'state' when 'EN_TRIAJE' then id_usuario(r->>'enf')
                                                when 'EN_CONSULTA' then id_usuario(r->>'med') end
    where id_turno = v_turno;

    -- Signos vitales (triaje)
    if jsonb_typeof(r->'tri') = 'object' then
      v_pa := regexp_match(r->'tri'->>'pa', '^\s*(\d{2,3})\s*/\s*(\d{2,3})\s*$');
      if v_pa is null then
        raise exception 'Presión arterial no válida: %', r->'tri'->>'pa' using errcode = 'P0001';
      end if;
      insert into signos_vitales (id_turno, id_usuario_enfermero, presion_sistolica, presion_diastolica,
                                  pulso, frecuencia_resp, temperatura, saturacion_spo2, peso_kg, talla_m,
                                  motivo_triaje, alerta_critica, fecha_toma)
      values (v_turno, id_usuario(r->>'enf'), v_pa[1]::smallint, v_pa[2]::smallint,
              (r->'tri'->>'fc')::numeric, (r->'tri'->>'fr')::numeric, (r->'tri'->>'t')::numeric,
              (r->'tri'->>'spo2')::numeric, (r->'tri'->>'peso')::numeric, (r->'tri'->>'talla')::numeric,
              left(r->'tri'->>'motivo', 255), r->>'prio' = 'CRITICA',
              coalesce(ts((r->>'tTriSave')::bigint), now()))
      on conflict (id_turno) do update set
        id_usuario_enfermero = excluded.id_usuario_enfermero,
        presion_sistolica = excluded.presion_sistolica, presion_diastolica = excluded.presion_diastolica,
        pulso = excluded.pulso, frecuencia_resp = excluded.frecuencia_resp,
        temperatura = excluded.temperatura, saturacion_spo2 = excluded.saturacion_spo2,
        peso_kg = excluded.peso_kg, talla_m = excluded.talla_m, motivo_triaje = excluded.motivo_triaje,
        alerta_critica = excluded.alerta_critica, fecha_toma = excluded.fecha_toma;
    end if;

    -- Atención médica, diagnósticos y receta
    if jsonb_typeof(r->'consult') = 'object' then
      d := r->'consult';
      insert into atencion_medica (id_turno, id_historia, id_usuario_medico, id_area, motivo_consulta,
                                   examen_clinico, destino_alta, detalle_destino, fecha_atencion)
      values (v_turno, v_hist, id_usuario(coalesce(d->'medico'->>'u', r->>'med')), id_area(d->>'area'),
              coalesce(nullif(r->'tri'->>'motivo', ''), 'Consulta'), d->>'notas',
              case d->>'dest' when 'Reposo médico' then 'REPOSO'
                              when 'Derivación a hospital' then 'DERIVACION_HOSPITAL' else 'ALTA' end,
              nullif(left(d->>'destx', 150), ''), ts((d->>'t')::bigint))
      on conflict (id_turno) do update set
        id_usuario_medico = excluded.id_usuario_medico, id_area = excluded.id_area,
        motivo_consulta = excluded.motivo_consulta, examen_clinico = excluded.examen_clinico,
        destino_alta = excluded.destino_alta, detalle_destino = excluded.detalle_destino,
        fecha_atencion = excluded.fecha_atencion
      returning id_atencion into v_atencion;

      delete from atencion_diagnostico where id_atencion = v_atencion;
      for m in select * from jsonb_array_elements(coalesce(d->'dx', '[]')) loop
        insert into diagnostico_cie10 (codigo_cie10, descripcion) values (m->>0, m->>1)
          on conflict (codigo_cie10) do nothing;
        insert into atencion_diagnostico (id_atencion, codigo_cie10, tipo_diagnostico)
        values (v_atencion, m->>0, case m->>2 when 'D' then 'DEFINITIVO' else 'PRESUNTIVO' end)
        on conflict (id_atencion, codigo_cie10) do update set tipo_diagnostico = excluded.tipo_diagnostico;
      end loop;

      if coalesce(d->>'rec', '') <> '' then
        insert into receta_medica (id_atencion, codigo_receta, fecha_emision)
        values (v_atencion, d->>'rec', ts((d->>'t')::bigint))
        on conflict (id_atencion) do update set codigo_receta = excluded.codigo_receta
        returning id_receta into v_receta;

        delete from detalle_receta where id_receta = v_receta;
        insert into detalle_receta (id_receta, medicamento, concentracion, dosis, frecuencia,
                                    duracion_dias, cantidad_solicitada)
        select v_receta, left(x->>'n', 120),
               coalesce(substring(x->>'n' from '(\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|UI|%))'), 'No indicada'),
               left(x->>'dosis', 60), left(x->>'frec', 60), (x->>'dias')::numeric,
               nullif(x->>'cant', '')::numeric
        from jsonb_array_elements(coalesce(d->'meds', '[]')) x
        where coalesce(trim(x->>'n'), '') <> '';
      end if;
    end if;
  end loop;

  -- Auditoría (solo inserción) -------------------------------------------
  for r in select * from jsonb_array_elements(coalesce(cambios->'audit', '[]')) loop
    v_usr := id_usuario(r->>'u');
    continue when v_usr is null;
    select a.tabla, a.operacion into v_tabla, v_oper from accion_auditoria(r->>'a', r->>'d') a;
    insert into auditoria (id_auditoria, id_usuario, tabla_afectada, operacion, valores_nuevos,
                           direccion_ip, fecha_hora)
    values (case when r->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 then (r->>'id')::uuid else gen_random_uuid() end,
            v_usr, v_tabla, v_oper,
            jsonb_build_object('accion', r->>'a', 'detalle', r->>'d'),
            coalesce(nullif(r->>'ip', ''), '0.0.0.0')::inet,
            coalesce(ts((r->>'t')::bigint), now()))
    on conflict (id_auditoria) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- sgc_restablecer(): vacía los datos (los catálogos se conservan).
-- La app vuelve a cargar los datos de demostración a continuación.
-- ---------------------------------------------------------------------
create function public.sgc_restablecer() returns void
language plpgsql security definer set search_path = public as $$
begin
  truncate auditoria, detalle_receta, receta_medica, atencion_diagnostico, atencion_medica,
           signos_vitales, turno, historia_clinica, paciente, umbral_clinico, usuario;
end $$;

-- =====================================================================
-- Seguridad (PROTOTIPO)
--   · La clave pública solo puede LEER las tablas y ejecutar las 3 funciones.
--     No puede escribir, modificar ni borrar filas directamente.
--   · Las funciones validan la máquina de estados y guardan todo en una sola
--     transacción; si algo falla, no se guarda nada.
--   · Pendiente para producción: Supabase Auth + políticas RLS por rol.
--     Mientras tanto, cualquiera con la clave pública puede leer los datos
--     y llamar a sgc_restablecer. Use solo datos ficticios.
-- =====================================================================
revoke all on all tables in schema public from anon, authenticated;
revoke all on schema sgc_interno from public, anon, authenticated;
revoke execute on all functions in schema sgc_interno from public;
revoke execute on function public.sgc_cargar(), public.sgc_guardar(jsonb), public.sgc_restablecer() from public;

grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on function public.sgc_cargar(), public.sgc_guardar(jsonb), public.sgc_restablecer()
  to anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['paciente','usuario','area_atencion','historia_clinica','turno','signos_vitales',
                           'atencion_medica','diagnostico_cie10','atencion_diagnostico','receta_medica',
                           'detalle_receta','umbral_clinico','auditoria'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy lectura_prototipo on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- Tiempo real: la pantalla de sala y las demás PCs se actualizan solas.
do $$
declare t text;
begin
  foreach t in array array['usuario','paciente','historia_clinica','turno','umbral_clinico','auditoria'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
