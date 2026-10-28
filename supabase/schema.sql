-- =====================================================================
-- SGC · Sistema web de gestión clínica (PMV) · Esquema para Supabase
-- Modelo de 13 entidades del informe (sección 2.5 y anexo A)
-- + 4 entidades de la ruta con pago y citas: ESPECIALIDAD, HORARIO_MEDICO, PAGO y CITA
-- + Supabase Auth + seguridad por rol (RLS) + API de funciones.
--
-- Ruta del paciente: Admisión → Caja (el no asegurado paga; con SIS se exonera)
--   → Triaje → Cita con el especialista según el horario del médico
--   → (si la cita es otro día, vuelve ese día) → Consulta → Alta.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar todo → Run.
-- Supabase avisará de "operaciones destructivas": son los DROP del
-- inicio, que reinstalan el esquema desde cero.
-- ATENCIÓN: ejecutarlo de nuevo BORRA TODOS LOS DATOS y restablece las
-- contraseñas de las cuentas de demostración.
--
-- Arquitectura de seguridad
--   · Autenticación: Supabase Auth (contraseñas bcrypt, sesión con JWT).
--   · Autorización: cada cuenta se vincula a una fila de USUARIO mediante
--     app_metadata.sgc_usuario (solo se puede fijar desde el servidor).
--     El rol de USUARIO decide qué filas puede leer cada persona (RLS).
--   · Escritura: nadie escribe directo en las tablas. La app llama a
--     sgc_guardar(), que valida rol, máquina de estados y datos, y fija en
--     el servidor quién hizo qué, cuándo y desde qué IP (auditoría).
--   · La prioridad de triaje la recalcula la base con los umbrales vigentes.
--   · El pago y la cita también los valida la base: tarifa, medio de pago,
--     horario del médico, cupo libre y reglas de prioridad (sgc_interno.guardar_cita).
--   · Pantalla de sala (sin sesión): solo sgc_sala(), sin nombres ni DNI.
--   · Cada estación carga solo los turnos de hoy y los abiertos. La historia
--     de un paciente (sgc_historia) y los indicadores de gestión
--     (sgc_indicadores, hechos anónimos solo para Jefatura) se piden aparte.
--
-- Diferencias con el modelo físico del informe (documentadas):
--   · Se agregan ESPECIALIDAD, HORARIO_MEDICO, PAGO y CITA, y USUARIO.id_especialidad.
--   · USUARIO.rol admite CAJA; TURNO.estado admite PENDIENTE_PAGO, PENDIENTE_CITA y CITADO.
--   · TURNO agrega ts_ultimo_llamado, veces_llamado e id_usuario_en_atencion.
--   · AUDITORIA.operacion admite también LOGOUT.
--   · DETALLE_RECETA.cantidad_solicitada es opcional.
--   · USUARIO.password_hash guarda la referencia a la credencial de Supabase
--     Auth ('auth:<id>'); el hash bcrypt vive en auth.users.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Limpieza (versiones anteriores del prototipo y reinstalación)
-- ---------------------------------------------------------------------
drop table if exists public.audit_log, public.turns, public.thresholds,
                     public.patients, public.staff cascade;

drop function if exists public.sgc_cargar();
drop function if exists public.sgc_guardar(jsonb);
drop function if exists public.sgc_restablecer();
drop function if exists public.sgc_restablecer_demo(jsonb);
drop function if exists public.sgc_restablecer_demo_lote(uuid, jsonb);
drop function if exists public.sgc_historia(text);
drop function if exists public.sgc_indicadores(date, date);
drop function if exists public.sgc_clave_cambiada();
drop function if exists public.sgc_sala();
drop schema if exists sgc_interno cascade;

drop table if exists public.cita, public.pago, public.horario_medico, public.especialidad cascade;
drop table if exists public.auditoria, public.umbral_clinico, public.detalle_receta,
                     public.receta_medica, public.atencion_diagnostico, public.diagnostico_cie10,
                     public.atencion_medica, public.signos_vitales, public.turno,
                     public.historia_clinica, public.area_atencion, public.usuario,
                     public.paciente cascade;

-- Cuentas de Supabase Auth creadas por versiones anteriores de este script
delete from auth.users where raw_app_meta_data ? 'sgc_usuario';

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;   -- crypt(), gen_salt()


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
-- 14. ESPECIALIDAD (catálogo). Su duración divide el horario del médico en cupos.
-- ---------------------------------------------------------------------
create table public.especialidad (
    id_especialidad    uuid         not null default gen_random_uuid(),
    codigo             varchar(5)   not null,
    nombre             varchar(60)  not null,
    duracion_cita_min  smallint     not null,
    activo             boolean      not null default true,
    constraint pk_especialidad primary key (id_especialidad),
    constraint uq_especialidad_codigo unique (codigo),
    constraint uq_especialidad_nombre unique (nombre),
    constraint ck_especialidad_duracion check (duracion_cita_min between 10 and 120)
);

-- ---------------------------------------------------------------------
-- 2. USUARIO (el médico pertenece a una especialidad)
-- ---------------------------------------------------------------------
create table public.usuario (
    id_usuario       uuid         not null default gen_random_uuid(),
    username         varchar(50)  not null,
    password_hash    varchar(255) not null,
    rol              varchar(15)  not null,
    nombre_completo  varchar(150) not null,
    colegiatura      varchar(15)  null,
    id_especialidad  uuid         null,
    activo           boolean      not null default true,
    creado_en        timestamptz  not null default now(),
    constraint pk_usuario primary key (id_usuario),
    constraint uq_usuario_username unique (username),
    constraint ck_usuario_rol check (rol in ('ADMISION','CAJA','ENFERMERIA','MEDICO','JEFATURA')),
    constraint ck_usuario_colegiatura check (rol <> 'MEDICO' or colegiatura is not null),
    constraint ck_usuario_especialidad check ((rol = 'MEDICO') = (id_especialidad is not null)),
    constraint fk_usuario_especialidad foreign key (id_especialidad)
        references public.especialidad (id_especialidad) on delete restrict on update cascade
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
-- 15. HORARIO_MEDICO: bloques semanales de atención de cada médico
--     (día ISO 1 = lunes … 7 = domingo). Los cruces de bloques del mismo
--     médico o del mismo consultorio los impide sgc_interno.guardar_horario().
-- ---------------------------------------------------------------------
create table public.horario_medico (
    id_horario         uuid      not null default gen_random_uuid(),
    id_usuario_medico  uuid      not null,
    id_area            uuid      not null,
    dia_semana         smallint  not null,
    hora_inicio        time      not null,
    hora_fin           time      not null,
    activo             boolean   not null default true,
    constraint pk_horario_medico primary key (id_horario),
    constraint ck_horario_dia check (dia_semana between 1 and 7),
    constraint ck_horario_horas check (hora_fin > hora_inicio and hora_inicio >= time '06:00' and hora_fin <= time '22:00'),
    constraint fk_horario_medico foreign key (id_usuario_medico)
        references public.usuario (id_usuario) on delete restrict on update cascade,
    constraint fk_horario_area foreign key (id_area)
        references public.area_atencion (id_area) on delete restrict on update cascade
);
create index ix_horario_medico_dia on public.horario_medico (id_usuario_medico, dia_semana) where activo;

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
    estado                 varchar(20)  not null default 'PENDIENTE_PAGO',
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
    constraint ck_turno_estado check (estado in ('PENDIENTE_PAGO','EN_ESPERA_TRIAJE','EN_TRIAJE','PENDIENTE_CITA',
                                                 'CITADO','EN_ESPERA_CONSULTA','LLAMANDO','EN_CONSULTA',
                                                 'ATENDIDO','CANCELADO')),
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
-- 16. PAGO (1:0..1 con TURNO): cobro de la consulta antes del triaje.
--     Con SIS (o SIS en validación) se registra un pago de S/ 0.00 sin boleta.
-- ---------------------------------------------------------------------
create table public.pago (
    id_pago             uuid          not null default gen_random_uuid(),
    id_turno            uuid          not null,
    id_usuario_cajero   uuid          not null,
    concepto            varchar(60)   not null default 'Consulta externa',
    monto               decimal(8,2)  not null,
    metodo_pago         varchar(10)   not null,
    numero_comprobante  varchar(15)   null,
    fecha_pago          timestamptz   not null default now(),
    constraint pk_pago primary key (id_pago),
    constraint uq_pago_turno unique (id_turno),
    constraint uq_pago_comprobante unique (numero_comprobante),
    constraint ck_pago_metodo check (metodo_pago in ('EFECTIVO','TARJETA','BILLETERA','SIS')),
    constraint ck_pago_monto check (
        (metodo_pago = 'SIS' and monto = 0 and numero_comprobante is null) or
        (metodo_pago <> 'SIS' and monto > 0 and numero_comprobante is not null)),
    constraint ck_pago_comprobante check (numero_comprobante is null or numero_comprobante ~ '^B001-[0-9]{6}$'),
    constraint fk_pago_turno foreign key (id_turno)
        references public.turno (id_turno) on delete restrict on update cascade,
    constraint fk_pago_cajero foreign key (id_usuario_cajero)
        references public.usuario (id_usuario) on delete restrict on update cascade
);
create index ix_pago_fecha on public.pago (fecha_pago);

-- ---------------------------------------------------------------------
-- 17. CITA (1:0..1 con TURNO): cita con el especialista, asignada después del
--     triaje según el horario del médico. Si es otro día, el turno queda CITADO
--     hasta que Admisión registra la llegada (ts_llegada).
-- ---------------------------------------------------------------------
create table public.cita (
    id_cita              uuid         not null default gen_random_uuid(),
    id_turno             uuid         not null,
    id_especialidad      uuid         not null,
    id_usuario_medico    uuid         not null,
    id_area              uuid         not null,
    fecha_cita           date         not null,
    hora_cita            time         not null,
    es_sobrecupo         boolean      not null default false,
    estado               varchar(12)  not null default 'PROGRAMADA',
    id_usuario_registro  uuid         not null,
    fecha_registro       timestamptz  not null default now(),
    ts_llegada           timestamptz  null,
    constraint pk_cita primary key (id_cita),
    constraint uq_cita_turno unique (id_turno),
    constraint ck_cita_estado check (estado in ('PROGRAMADA','ATENDIDA','NO_ASISTIO','CANCELADA')),
    constraint fk_cita_turno foreign key (id_turno)
        references public.turno (id_turno) on delete restrict on update cascade,
    constraint fk_cita_especialidad foreign key (id_especialidad)
        references public.especialidad (id_especialidad) on delete restrict on update cascade,
    constraint fk_cita_medico foreign key (id_usuario_medico)
        references public.usuario (id_usuario) on delete restrict on update cascade,
    constraint fk_cita_area foreign key (id_area)
        references public.area_atencion (id_area) on delete restrict on update cascade,
    constraint fk_cita_registro foreign key (id_usuario_registro)
        references public.usuario (id_usuario) on delete restrict on update cascade
);
-- Un cupo (médico, fecha y hora) no se da dos veces. Los sobrecupos y las citas
-- canceladas o no asistidas no ocupan cupo.
create unique index uq_cita_cupo on public.cita (id_usuario_medico, fecha_cita, hora_cita)
    where not es_sobrecupo and estado not in ('CANCELADA','NO_ASISTIO');
create index ix_cita_agenda on public.cita (fecha_cita, id_usuario_medico);

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
-- Cartera de servicios de un establecimiento de primer nivel (I-3/I-4): atención médica, materno-infantil,
-- salud bucal, y salud mental y nutrición (las ramas solo agrupan en pantalla: src/lib/constants.js)
insert into public.especialidad (codigo, nombre, duracion_cita_min) values
  ('MG',   'Medicina General', 20),
  ('MF',   'Medicina Familiar', 20),
  ('MI',   'Medicina Interna', 30),
  ('CAR',  'Cardiología',      30),
  ('PED',  'Pediatría',        20),
  ('CRED', 'Crecimiento y Desarrollo', 30),
  ('GIN',  'Ginecología y Obstetricia', 20),
  ('OBS',  'Obstetricia',      30),
  ('ODO',  'Odontología',      30),
  ('PSI',  'Psicología',       40),
  ('NUT',  'Nutrición',        30);

insert into public.area_atencion (nombre, tipo) values
  ('Módulo de Triaje 1', 'TRIAJE'),
  ('Consultorio 1', 'CONSULTORIO'),
  ('Consultorio 2', 'CONSULTORIO'),
  ('Consultorio 3', 'CONSULTORIO'),
  ('Consultorio 4', 'CONSULTORIO'),
  ('Consultorio 5', 'CONSULTORIO'),
  ('Consultorio 6', 'CONSULTORIO'),
  ('Consultorio 7', 'CONSULTORIO'),
  ('Consultorio 8', 'CONSULTORIO');

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
  ('R50.9', 'Fiebre, no especificada'),
  ('Z00.0', 'Examen médico general'),
  ('E78.5', 'Hiperlipidemia, no especificada'),
  ('Z00.1', 'Control de salud de rutina del niño'),
  ('D50.9', 'Anemia por deficiencia de hierro, sin otra especificación'),
  ('Z34.9', 'Supervisión de embarazo normal, no especificado'),
  ('Z30.0', 'Consejo y asesoramiento general sobre la anticoncepción'),
  ('N76.0', 'Vaginitis aguda'),
  ('K02.9', 'Caries dental, no especificada'),
  ('K05.1', 'Gingivitis crónica'),
  ('F41.1', 'Trastorno de ansiedad generalizada'),
  ('F32.9', 'Episodio depresivo, no especificado'),
  ('E66.9', 'Obesidad, no especificada');


-- =====================================================================
-- Funciones internas (esquema sgc_interno, no expuesto por la API)
-- =====================================================================
create schema sgc_interno;

-- Dominio de las cuentas: el usuario "a.admision" inicia sesión como a.admision@sgc.example.org
create function sgc_interno.dominio() returns text
language sql immutable set search_path = '' as $$ select 'sgc.example.org' $$;

-- Milisegundos desde 1970 (formato de la app) <-> timestamptz, sin pérdida
create function sgc_interno.ts(ms bigint) returns timestamptz
language sql immutable set search_path = '' as $$ select case when ms is null then null
  else timestamptz 'epoch' + ms * interval '1 millisecond' end $$;

create function sgc_interno.ms(t timestamptz) returns bigint
language sql immutable set search_path = '' as $$ select round(extract(epoch from t) * 1000)::bigint $$;

-- Estado tal como lo usa la app: LLAMANDO se distingue por si ya hubo triaje
create function sgc_interno.estado_app(p_estado text, p_fin_triaje timestamptz) returns text
language sql immutable set search_path = '' as $$
  select case when p_estado = 'LLAMANDO'
              then case when p_fin_triaje is null then 'LLAMADO_TRIAJE' else 'LLAMADO_CONSULTA' end
              else p_estado end $$;

-- Máquina de estados del turno (la misma de src/lib/clinical.js)
create function sgc_interno.transicion_valida(p_desde text, p_hacia text) returns boolean
language sql immutable set search_path = '' as $$
  select (p_desde, p_hacia) in (
    ('PENDIENTE_PAGO','EN_ESPERA_TRIAJE'),   ('PENDIENTE_PAGO','CANCELADO'),
    ('EN_ESPERA_TRIAJE','LLAMADO_TRIAJE'),   ('EN_ESPERA_TRIAJE','CANCELADO'),
    ('LLAMADO_TRIAJE','LLAMADO_TRIAJE'),     ('LLAMADO_TRIAJE','EN_TRIAJE'), ('LLAMADO_TRIAJE','CANCELADO'),
    ('EN_TRIAJE','PENDIENTE_CITA'),          ('EN_TRIAJE','EN_ESPERA_TRIAJE'),
    ('PENDIENTE_CITA','EN_ESPERA_CONSULTA'), ('PENDIENTE_CITA','CITADO'), ('PENDIENTE_CITA','CANCELADO'),
    ('CITADO','CITADO'),                     ('CITADO','EN_ESPERA_CONSULTA'), ('CITADO','CANCELADO'),
    ('CITADO','PENDIENTE_PAGO'),             ('CITADO','EN_ESPERA_TRIAJE'),   ('EN_TRIAJE','EN_ESPERA_CONSULTA'),
    ('EN_ESPERA_CONSULTA','LLAMADO_CONSULTA'), ('EN_ESPERA_CONSULTA','CANCELADO'),
    ('LLAMADO_CONSULTA','LLAMADO_CONSULTA'), ('LLAMADO_CONSULTA','EN_CONSULTA'), ('LLAMADO_CONSULTA','CANCELADO'),
    ('EN_CONSULTA','ATENDIDO'),              ('EN_CONSULTA','EN_ESPERA_CONSULTA')) $$;

-- Qué rol puede hacer cada cambio de estado
create function sgc_interno.rol_puede(p_rol text, p_desde text, p_hacia text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_rol
    when 'CAJA'       then p_desde = 'PENDIENTE_PAGO' and p_hacia in ('EN_ESPERA_TRIAJE','CANCELADO')
    when 'ENFERMERIA' then (p_desde in ('EN_ESPERA_TRIAJE','LLAMADO_TRIAJE') and p_hacia in ('LLAMADO_TRIAJE','CANCELADO'))
                        -- al terminar el triaje, Enfermería da la cita (el paciente no vuelve a Admisión)
                        or (p_desde = 'PENDIENTE_CITA' and p_hacia in ('EN_ESPERA_CONSULTA','CITADO'))
                        or (p_desde = 'LLAMADO_TRIAJE' and p_hacia = 'EN_TRIAJE')
                        or (p_desde = 'EN_TRIAJE' and p_hacia in ('EN_ESPERA_TRIAJE','PENDIENTE_CITA','EN_ESPERA_CONSULTA'))
    when 'MEDICO'     then (p_desde in ('EN_ESPERA_CONSULTA','LLAMADO_CONSULTA') and p_hacia in ('LLAMADO_CONSULTA','CANCELADO'))
                        or (p_desde = 'LLAMADO_CONSULTA' and p_hacia = 'EN_CONSULTA')
                        or (p_desde = 'EN_CONSULTA' and p_hacia in ('ATENDIDO','EN_ESPERA_CONSULTA'))
    when 'ADMISION'   then p_hacia = 'CANCELADO'
                        or (p_desde in ('PENDIENTE_CITA','CITADO') and p_hacia in ('EN_ESPERA_CONSULTA','CITADO'))
                        -- llegada de quien reservó por web o teléfono: va a Caja o, con SIS, a triaje
                        or (p_desde = 'CITADO' and p_hacia in ('PENDIENTE_PAGO','EN_ESPERA_TRIAJE'))
    else false end $$;

-- Umbrales: clave de la app -> (parámetro, nivel, operador)
create function sgc_interno.mapa_umbral() returns table (clave text, parametro text, nivel text, operador text)
language sql immutable set search_path = '' as $$
  values ('spo2','SPO2','CRITICO','<'),          ('spo2A','SPO2','ALERTA','<='),
         ('tmp','TEMPERATURA','CRITICO','>='),   ('tmpA','TEMPERATURA','ALERTA','>='),
         ('pasLo','PAS','CRITICO','<'),          ('pasA','PAS','ALERTA','>='),
         ('fcHi','PULSO_MAX','CRITICO','>'),     ('fcA','PULSO_MAX','ALERTA','>'),
         ('frHi','FR_MAX','CRITICO','>'),        ('frA','FR_MAX','ALERTA','>=') $$;

-- Prioridad de triaje con los umbrales vigentes (misma regla que evalTriage en clinical.js)
create function sgc_interno.prioridad(p_pas numeric, p_fc numeric, p_fr numeric, p_temp numeric, p_spo2 numeric)
returns text language sql stable security definer set search_path = '' as $$
  with u as (
    select m.clave, uc.valor_umbral v
    from public.umbral_clinico uc
    join sgc_interno.mapa_umbral() m on m.parametro = uc.parametro and m.nivel = uc.nivel
    where uc.vigente_hasta is null),
  t as (
    select max(v) filter (where clave = 'spo2') spo2,  max(v) filter (where clave = 'spo2A') spo2a,
           max(v) filter (where clave = 'tmp') tmp,    max(v) filter (where clave = 'tmpA') tmpa,
           max(v) filter (where clave = 'pasLo') paslo, max(v) filter (where clave = 'pasA') pasa,
           max(v) filter (where clave = 'fcHi') fchi,  max(v) filter (where clave = 'fcA') fca,
           max(v) filter (where clave = 'frHi') frhi,  max(v) filter (where clave = 'frA') fra
    from u)
  select case
    when p_spo2 < t.spo2 or p_fc > t.fchi or p_fc < 40 or p_pas < t.paslo
         or p_fr > t.frhi or p_fr < 8 or p_temp >= t.tmp then 'CRITICA'
    when p_spo2 <= t.spo2a or p_fc > t.fca or p_pas >= t.pasa
         or p_fr >= t.fra or p_temp >= t.tmpa then 'PRIORITARIA'
    else 'NORMAL' end
  from t $$;

-- Acción de la app -> (tabla afectada, operación) para AUDITORIA
create function sgc_interno.accion_auditoria(p_accion text, p_detalle text, out tabla text, out operacion text)
language sql immutable set search_path = '' as $$
  select case p_accion
           when 'LOGIN' then 'usuario'             when 'LOGOUT' then 'usuario'
           when 'USUARIO' then 'usuario'           when 'RESET_CLAVE' then 'usuario'
           when 'CAMBIO_CLAVE' then 'usuario'      when 'AREA' then 'area_atencion'
           when 'BUSQUEDA_DNI' then 'paciente'     when 'PACIENTE_NUEVO' then 'paciente'
           when 'ALERGIAS' then 'historia_clinica' when 'HC_CONSULTADA' then 'historia_clinica'
           when 'TRIAJE_GUARDADO' then 'signos_vitales'
           when 'ATENCION_FINALIZADA' then 'atencion_medica'
           when 'ALERGIA_CONFIRMADA' then 'receta_medica'
           when 'UMBRALES' then 'umbral_clinico'
           when 'PAGO_REGISTRADO' then 'pago'      when 'CITA_ASIGNADA' then 'cita'
           when 'CITA_REPROGRAMADA' then 'cita'    when 'LLEGADA_CITA' then 'cita'
           when 'HORARIO' then 'horario_medico'   when 'CITA_WEB' then 'cita'
           else 'turno' end,
         case when p_accion in ('LOGIN','LOGOUT') then p_accion
              when p_accion in ('BUSQUEDA_DNI','HC_CONSULTADA','AREA') then 'SELECT'
              when p_accion in ('PACIENTE_NUEVO','TURNO_CREADO','TRIAJE_GUARDADO','ATENCION_FINALIZADA',
                                'ALERGIA_CONFIRMADA','UMBRALES','PAGO_REGISTRADO','CITA_ASIGNADA','CITA_WEB') then 'INSERT'
              when p_accion = 'USUARIO' and p_detalle like '% creado%' then 'INSERT'
              when p_accion = 'HORARIO' and p_detalle like 'Horario agregado%' then 'INSERT'
              else 'UPDATE' end $$;

-- IP del cliente (Supabase la entrega en x-forwarded-for)
create function sgc_interno.ip_cliente() returns inet
language plpgsql stable set search_path = '' as $$
begin
  return coalesce(nullif(trim(split_part(
           current_setting('request.headers', true)::json->>'x-forwarded-for', ',', 1)), '')::inet,
         inet_client_addr(), '0.0.0.0'::inet);
exception when others then
  return '0.0.0.0'::inet;
end $$;

-- Cuentas que aún usan la contraseña temporal entregada por Jefatura (hash vigente al entregarla).
-- Mientras exista la fila, la cuenta no accede a ningún dato: solo puede cambiar su contraseña.
create table sgc_interno.clave_temporal (
    id_auth uuid not null primary key,
    hash    text not null
);

-- Usuario del sistema que corresponde a la sesión (o nada si no hay sesión, está inactivo
-- o todavía no cambió su contraseña temporal)
create function sgc_interno.usuario_actual(out id_usuario uuid, out username text, out rol text, out nombre text)
language sql stable security definer set search_path = '' as $$
  select u.id_usuario, u.username::text, u.rol::text, u.nombre_completo::text
  from public.usuario u
  where u.activo
    and u.username = (select auth.jwt() -> 'app_metadata' ->> 'sgc_usuario')
    and not exists (select 1 from sgc_interno.clave_temporal c where c.id_auth = (select auth.uid())) $$;

create function sgc_interno.rol_actual() returns text
language sql stable security definer set search_path = '' as $$
  select rol from sgc_interno.usuario_actual() $$;

-- Antecedentes patológicos: solo Enfermería y Medicina (Admisión ve el número de historia y las alergias)
create function sgc_interno.antecedentes(p_historia uuid) returns text
language sql stable security definer set search_path = '' as $$
  select h.antecedentes_patologicos from public.historia_clinica h
  where h.id_historia = p_historia and sgc_interno.rol_actual() in ('ENFERMERIA','MEDICO') $$;

-- Motivo del triaje para Admisión: lo necesita para elegir la especialidad de la cita (no ve los signos vitales)
create function sgc_interno.motivo_triaje(p_turno uuid) returns text
language sql stable security definer set search_path = '' as $$
  select sv.motivo_triaje from public.signos_vitales sv
  where sv.id_turno = p_turno and sgc_interno.rol_actual() = 'ADMISION' $$;

create function sgc_interno.id_usuario(p_username text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id_usuario from public.usuario where username = p_username $$;

create function sgc_interno.id_area(p_nombre text, p_crear boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if p_nombre is null or p_nombre = '' then return null; end if;
  select id_area into v from public.area_atencion where nombre = p_nombre;
  if v is null and p_crear then
    insert into public.area_atencion (nombre, tipo)
    values (p_nombre, case when p_nombre ilike '%triaje%' then 'TRIAJE' else 'CONSULTORIO' end)
    returning id_area into v;
  end if;
  return v;
end $$;

-- Crea o actualiza la cuenta de Supabase Auth de un usuario del sistema
create function sgc_interno.fijar_credencial(p_username text, p_clave text, p_debe_cambiar boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_email text := lower(p_username || '@' || sgc_interno.dominio());
begin
  if p_clave is null or length(p_clave) < 8 or p_clave !~ '[A-Za-z]' or p_clave !~ '[0-9]' then
    raise exception 'La contraseña debe tener al menos 8 caracteres, con letras y números.' using errcode = 'P0001';
  end if;
  select id into v_id from auth.users where lower(email) = v_email;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token,
      is_sso_user, is_anonymous)
    values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
      extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'sgc_usuario', p_username,
                         'debe_cambiar_clave', p_debe_cambiar),
      '{}'::jsonb, now(), now(),
      '', '', '', '', '', '', '', '', false, false);
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_id::text, v_id,
            jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
            'email', now(), now(), now());
  else
    update auth.users
       set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf', 10)),
           raw_app_meta_data  = coalesce(raw_app_meta_data, '{}'::jsonb)
                                || jsonb_build_object('sgc_usuario', p_username, 'debe_cambiar_clave', p_debe_cambiar),
           updated_at = now()
     where id = v_id;
    -- Cierra las sesiones abiertas con la clave anterior
    delete from auth.sessions where user_id = v_id;
  end if;
  -- El aviso de cambio obligatorio va en app_metadata (el usuario no puede editarlo) y se hace cumplir
  -- en el servidor con sgc_interno.clave_temporal
  delete from sgc_interno.clave_temporal where id_auth = v_id;
  if p_debe_cambiar then
    insert into sgc_interno.clave_temporal (id_auth, hash)
    select v_id, encrypted_password from auth.users where id = v_id;
  end if;
  update public.usuario set password_hash = 'auth:' || v_id where username = p_username;
  return v_id;
end $$;

-- Registro de triaje (signos vitales)
create function sgc_interno.guardar_signos(p_turno uuid, p_tri jsonb, p_enfermero uuid, p_fecha timestamptz, p_prio text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pa text[];
begin
  v_pa := regexp_match(p_tri->>'pa', '^\s*(\d{2,3})\s*/\s*(\d{2,3})\s*$');
  if v_pa is null then
    raise exception 'Presión arterial no válida: %', p_tri->>'pa' using errcode = 'P0001';
  end if;
  if p_enfermero is null then
    raise exception 'Falta el profesional de enfermería del triaje.' using errcode = 'P0001';
  end if;
  insert into public.signos_vitales (id_turno, id_usuario_enfermero, presion_sistolica, presion_diastolica,
                              pulso, frecuencia_resp, temperatura, saturacion_spo2, peso_kg, talla_m,
                              motivo_triaje, alerta_critica, fecha_toma)
  values (p_turno, p_enfermero, v_pa[1]::smallint, v_pa[2]::smallint,
          (p_tri->>'fc')::numeric, (p_tri->>'fr')::numeric, (p_tri->>'t')::numeric,
          (p_tri->>'spo2')::numeric, (p_tri->>'peso')::numeric, (p_tri->>'talla')::numeric,
          left(p_tri->>'motivo', 255), p_prio = 'CRITICA', p_fecha)
  on conflict (id_turno) do update set
    id_usuario_enfermero = excluded.id_usuario_enfermero,
    presion_sistolica = excluded.presion_sistolica, presion_diastolica = excluded.presion_diastolica,
    pulso = excluded.pulso, frecuencia_resp = excluded.frecuencia_resp,
    temperatura = excluded.temperatura, saturacion_spo2 = excluded.saturacion_spo2,
    peso_kg = excluded.peso_kg, talla_m = excluded.talla_m, motivo_triaje = excluded.motivo_triaje,
    alerta_critica = excluded.alerta_critica, fecha_toma = excluded.fecha_toma;
end $$;

-- Atención médica, diagnósticos CIE-10 y receta
create function sgc_interno.guardar_atencion(p_turno uuid, p_historia uuid, p_consult jsonb, p_medico uuid,
                                             p_area uuid, p_fecha timestamptz, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m jsonb; v_atencion uuid; v_receta uuid;
begin
  if p_medico is null or p_area is null then
    raise exception 'Falta el médico o el consultorio de la atención.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_consult->>'notas'), '') = '' then
    raise exception 'Registre la anamnesis y el examen clínico.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p_consult->'dx', '[]')) = 0 then
    raise exception 'Seleccione al menos un diagnóstico CIE-10.' using errcode = 'P0001';
  end if;
  insert into public.atencion_medica (id_turno, id_historia, id_usuario_medico, id_area, motivo_consulta,
                                      examen_clinico, destino_alta, detalle_destino, fecha_atencion)
  values (p_turno, p_historia, p_medico, p_area, coalesce(nullif(p_motivo, ''), 'Consulta'), p_consult->>'notas',
          case p_consult->>'dest' when 'Reposo médico' then 'REPOSO'
                                  when 'Derivación a hospital' then 'DERIVACION_HOSPITAL' else 'ALTA' end,
          nullif(left(p_consult->>'destx', 150), ''), p_fecha)
  on conflict (id_turno) do update set
    id_usuario_medico = excluded.id_usuario_medico, id_area = excluded.id_area,
    motivo_consulta = excluded.motivo_consulta, examen_clinico = excluded.examen_clinico,
    destino_alta = excluded.destino_alta, detalle_destino = excluded.detalle_destino,
    fecha_atencion = excluded.fecha_atencion
  returning id_atencion into v_atencion;

  delete from public.atencion_diagnostico where id_atencion = v_atencion;
  for m in select * from jsonb_array_elements(coalesce(p_consult->'dx', '[]')) loop
    if not exists (select 1 from public.diagnostico_cie10 where codigo_cie10 = m->>0) then
      raise exception 'El código CIE-10 % no está en el catálogo.', m->>0 using errcode = 'P0001';
    end if;
    insert into public.atencion_diagnostico (id_atencion, codigo_cie10, tipo_diagnostico)
    values (v_atencion, m->>0, case m->>2 when 'D' then 'DEFINITIVO' else 'PRESUNTIVO' end)
    on conflict (id_atencion, codigo_cie10) do update set tipo_diagnostico = excluded.tipo_diagnostico;
  end loop;

  if coalesce(p_consult->>'rec', '') <> '' then
    insert into public.receta_medica (id_atencion, codigo_receta, fecha_emision)
    values (v_atencion, p_consult->>'rec', p_fecha)
    on conflict (id_atencion) do update set codigo_receta = excluded.codigo_receta
    returning id_receta into v_receta;

    delete from public.detalle_receta where id_receta = v_receta;
    insert into public.detalle_receta (id_receta, medicamento, concentracion, dosis, frecuencia,
                                       duracion_dias, cantidad_solicitada)
    select v_receta, left(x->>'n', 120),
           coalesce(substring(x->>'n' from '(\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|UI|%))'), 'No indicada'),
           left(x->>'dosis', 60), left(x->>'frec', 60), (x->>'dias')::numeric,
           nullif(x->>'cant', '')::numeric
    from jsonb_array_elements(coalesce(p_consult->'meds', '[]')) x
    where coalesce(trim(x->>'n'), '') <> '';
  end if;
end $$;

-- Hoy en el centro de salud (Lima)
create function sgc_interno.hoy() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'America/Lima')::date $$;

-- Tarifa de la consulta externa y condiciones de seguro exoneradas (las mismas de src/lib/constants.js)
create function sgc_interno.tarifa() returns numeric
language sql immutable set search_path = '' as $$ select 20.00::numeric $$;
create function sgc_interno.exonerado(p_sis text) returns boolean
language sql immutable set search_path = '' as $$ select p_sis in ('ACTIVO','PENDIENTE_VALIDACION') $$;

-- Pago de la consulta (con SIS: S/ 0.00 sin boleta)
create function sgc_interno.guardar_pago(p_turno uuid, p_pago jsonb, p_cajero uuid, p_fecha timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_cajero is null then
    raise exception 'Falta quién registró el pago.' using errcode = 'P0001';
  end if;
  insert into public.pago (id_turno, id_usuario_cajero, concepto, monto, metodo_pago, numero_comprobante, fecha_pago)
  values (p_turno, p_cajero, 'Consulta externa', (p_pago->>'monto')::numeric, p_pago->>'metodo',
          nullif(p_pago->>'comp', ''), p_fecha);
end $$;

-- ---------------------------------------------------------------------
-- Cita de un turno, con las mismas reglas de src/lib/agenda.js (p_validar):
--   · el médico está activo, es de la especialidad y atiende ese día;
--   · la fecha está entre hoy y 30 días; un paciente crítico se atiende hoy;
--   · cita normal: empieza justo en un cupo de su horario, no pasó y está libre;
--   · sobrecupo: solo prioridad crítica, solo hoy y con un médico que aún atiende.
-- Si se reprograma, se reemplaza la cita del turno. Devuelve la fecha de la cita.
-- ---------------------------------------------------------------------
create function sgc_interno.guardar_cita(p_turno uuid, p_cita jsonb, p_usuario uuid, p_prio text, p_validar boolean)
returns date language plpgsql security definer set search_path = '' as $$
declare
  v_ts timestamptz := sgc_interno.ts((p_cita->>'at')::bigint);
  v_fecha date := (v_ts at time zone 'America/Lima')::date;
  v_hora time := (v_ts at time zone 'America/Lima')::time;
  v_ahora time := (now() at time zone 'America/Lima')::time;
  v_sobre boolean := coalesce((p_cita->>'sobre')::boolean, false);
  v_esp record; v_med record; v_h record;
begin
  if v_ts is null then
    raise exception 'Falta la fecha y hora de la cita.' using errcode = 'P0001';
  end if;
  select * into v_esp from public.especialidad where codigo = p_cita->>'esp' and activo;
  if v_esp.id_especialidad is null then
    raise exception 'Especialidad no válida: %', p_cita->>'esp' using errcode = 'P0001';
  end if;
  select id_usuario, nombre_completo, id_especialidad into v_med from public.usuario
   where username = p_cita->>'med' and rol = 'MEDICO' and activo;
  if v_med.id_usuario is null then
    raise exception 'El médico de la cita no está activo.' using errcode = 'P0001';
  end if;
  if v_med.id_especialidad <> v_esp.id_especialidad then
    raise exception '% no atiende %.', v_med.nombre_completo, v_esp.nombre using errcode = 'P0001';
  end if;

  -- Bloque del horario que contiene la cita (para un sobrecupo: uno de hoy que aún no termina)
  select h.* into v_h from public.horario_medico h
   where h.id_usuario_medico = v_med.id_usuario and h.activo and h.dia_semana = extract(isodow from v_fecha)
     and case when v_sobre then h.hora_fin > v_ahora
              else v_hora >= h.hora_inicio
                   and v_hora + make_interval(mins => v_esp.duracion_cita_min) <= h.hora_fin
                   and mod(extract(epoch from v_hora - h.hora_inicio)::numeric, v_esp.duracion_cita_min * 60) = 0 end
   order by (v_hora >= h.hora_inicio and v_hora < h.hora_fin) desc, h.hora_inicio
   limit 1;

  if p_validar then
    if v_fecha < sgc_interno.hoy() or v_fecha > sgc_interno.hoy() + 30 then
      raise exception 'La cita debe ser entre hoy y los próximos 30 días.' using errcode = 'P0001';
    end if;
    if p_prio = 'CRITICA' and v_fecha <> sgc_interno.hoy() then
      raise exception 'Prioridad crítica: el paciente debe atenderse hoy.' using errcode = 'P0001';
    end if;
    if v_sobre and p_prio is distinct from 'CRITICA' then
      raise exception 'El sobrecupo es solo para pacientes con prioridad crítica.' using errcode = 'P0001';
    end if;
    if v_h.id_horario is null then
      raise exception '% no atiende el % a las %.', v_med.nombre_completo, to_char(v_fecha, 'DD/MM/YYYY'),
                      to_char(v_hora, 'HH24:MI') using errcode = 'P0001';
    end if;
    if not v_sobre and v_ts <= now() then
      raise exception 'Ese cupo ya pasó. Elija otro.' using errcode = 'P0001';
    end if;
    if not v_sobre and exists (
         select 1 from public.cita c
          where c.id_usuario_medico = v_med.id_usuario and c.fecha_cita = v_fecha and c.id_turno <> p_turno
            and not c.es_sobrecupo and c.estado not in ('CANCELADA','NO_ASISTIO')
            and c.hora_cita >= v_hora and c.hora_cita < v_hora + make_interval(mins => v_esp.duracion_cita_min)) then
      raise exception 'Ese cupo ya fue tomado desde otra estación. Elija otro.' using errcode = 'P0001';
    end if;
  end if;

  insert into public.cita (id_turno, id_especialidad, id_usuario_medico, id_area, fecha_cita, hora_cita,
                           es_sobrecupo, estado, id_usuario_registro, fecha_registro)
  values (p_turno, v_esp.id_especialidad, v_med.id_usuario,
          coalesce(v_h.id_area, sgc_interno.id_area(p_cita->>'area', true)), v_fecha, v_hora, v_sobre, 'PROGRAMADA',
          p_usuario, case when p_validar then now() else coalesce(sgc_interno.ts((p_cita->>'t')::bigint), now()) end)
  on conflict (id_turno) do update set
    id_especialidad = excluded.id_especialidad, id_usuario_medico = excluded.id_usuario_medico,
    id_area = excluded.id_area, fecha_cita = excluded.fecha_cita, hora_cita = excluded.hora_cita,
    es_sobrecupo = excluded.es_sobrecupo, estado = 'PROGRAMADA', ts_llegada = null;
  return v_fecha;
end $$;

-- Estado de la cita cuando el turno se cierra
create function sgc_interno.cerrar_cita(p_turno uuid, p_estado_turno text, p_motivo text)
returns void language sql security definer set search_path = '' as $$
  update public.cita set estado = case
           when p_estado_turno = 'ATENDIDO' then 'ATENDIDA'
           when p_motivo in ('No asistió a su cita', 'No se presentó al llamado') then 'NO_ASISTIO'
           else 'CANCELADA' end
   where id_turno = p_turno $$;

-- ---------------------------------------------------------------------
-- Bloque de horario de un médico (Jefatura). Impide cruces con otro bloque
-- del mismo médico o de otro médico en el mismo consultorio, y no deja quitar
-- un bloque que tiene citas por atender.
-- ---------------------------------------------------------------------
create function sgc_interno.guardar_horario(r jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_med uuid; v_dur int; v_area uuid; v_choque text;
  v_id uuid := case when r->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (r->>'id')::uuid end;
  v_dia int := (r->>'dow')::int;
  v_ini time := (r->>'ini')::time;
  v_fin time := (r->>'fin')::time;
  v_on boolean := coalesce((r->>'on')::boolean, true);
begin
  select u.id_usuario, e.duracion_cita_min into v_med, v_dur
    from public.usuario u join public.especialidad e on e.id_especialidad = u.id_especialidad
   where u.username = r->>'med' and u.rol = 'MEDICO';
  if v_med is null then
    raise exception 'El horario debe ser de un médico con especialidad.' using errcode = 'P0001';
  end if;
  select id_area into v_area from public.area_atencion where nombre = r->>'area' and tipo = 'CONSULTORIO' and activo;
  if v_area is null then
    raise exception 'Consultorio no válido: %', r->>'area' using errcode = 'P0001';
  end if;
  if v_on then
    if extract(epoch from v_fin - v_ini) / 60 < v_dur then
      raise exception 'El bloque debe durar al menos una cita (% min).', v_dur using errcode = 'P0001';
    end if;
    select u.nombre_completo || ' en ' || a.nombre || ' de ' || to_char(h.hora_inicio, 'HH24:MI') || ' a ' || to_char(h.hora_fin, 'HH24:MI')
      into v_choque
      from public.horario_medico h
      join public.usuario u on u.id_usuario = h.id_usuario_medico
      join public.area_atencion a on a.id_area = h.id_area
     where h.activo and h.dia_semana = v_dia and h.id_horario is distinct from v_id
       and (h.id_usuario_medico = v_med or h.id_area = v_area)
       and h.hora_inicio < v_fin and v_ini < h.hora_fin
     limit 1;
    if v_choque is not null then
      raise exception 'El horario se cruza con otro bloque ese día: %.', v_choque using errcode = 'P0001';
    end if;
  elsif exists (select 1 from public.cita c join public.turno t on t.id_turno = c.id_turno
                 where c.id_usuario_medico = v_med and c.estado = 'PROGRAMADA'
                   and t.estado not in ('ATENDIDO','CANCELADO') and c.fecha_cita >= sgc_interno.hoy()
                   and extract(isodow from c.fecha_cita) = v_dia and c.hora_cita >= v_ini and c.hora_cita < v_fin) then
    raise exception 'Hay citas por atender en este horario. Reprográmelas antes de quitarlo.' using errcode = 'P0001';
  end if;
  insert into public.horario_medico (id_horario, id_usuario_medico, id_area, dia_semana, hora_inicio, hora_fin, activo)
  values (coalesce(v_id, gen_random_uuid()), v_med, v_area, v_dia, v_ini, v_fin, v_on)
  on conflict (id_horario) do update set activo = excluded.activo;
end $$;

-- Nueva versión de umbrales (cierra la vigente)
create function sgc_interno.guardar_umbrales(p_vals jsonb, p_aprobador text, p_desde timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_aprob uuid;
begin
  if exists (select 1 from public.umbral_clinico where vigente_desde = p_desde) then return; end if;
  select id_usuario into v_aprob from public.usuario
   where nombre_completo = p_aprobador and rol = 'MEDICO' order by activo desc limit 1;
  if v_aprob is null then
    raise exception 'El aprobador de los umbrales debe ser un médico registrado (%).', p_aprobador using errcode = 'P0001';
  end if;
  update public.umbral_clinico set vigente_hasta = p_desde
   where vigente_hasta is null and vigente_desde < p_desde;
  insert into public.umbral_clinico (parametro, nivel, operador, valor_umbral, id_usuario_aprobador, vigente_desde)
  select m.parametro, m.nivel, m.operador, (p_vals->>m.clave)::numeric, v_aprob, p_desde
  from sgc_interno.mapa_umbral() m where p_vals ? m.clave;
end $$;

create function sgc_interno.guardar_auditoria(p_usuario uuid, p_accion text, p_detalle text, p_ip inet,
                                              p_fecha timestamptz, p_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tabla text; v_oper text;
begin
  select a.tabla, a.operacion into v_tabla, v_oper from sgc_interno.accion_auditoria(p_accion, p_detalle) a;
  insert into public.auditoria (id_auditoria, id_usuario, tabla_afectada, operacion, valores_nuevos, direccion_ip, fecha_hora)
  values (case when p_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then p_id::uuid else gen_random_uuid() end,
          p_usuario, v_tabla, v_oper,
          jsonb_build_object('accion', left(p_accion, 40), 'detalle', left(p_detalle, 300)),
          coalesce(p_ip, '0.0.0.0'::inet), p_fecha)
  on conflict (id_auditoria) do nothing;
end $$;

-- Carga de datos históricos de demostración (confía en las fechas y autores del lote).
-- Solo se usa desde sgc_restablecer_demo(), que exige rol JEFATURA.
create function sgc_interno.importar(cambios jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; v_pac uuid; v_hist uuid; v_turno uuid; v_usr uuid; v_estado text;
begin
  for r in select * from jsonb_array_elements(coalesce(cambios->'patients', '[]')) loop
    insert into public.paciente (tipo_documento, numero_documento, nombres, apellidos,
                                 fecha_nacimiento, sexo, telefono, condicion_sis)
    values ('DNI', r->>'dni', r->>'nom', r->>'ape', (r->>'nac')::date, r->>'sexo', nullif(r->>'tel', ''), r->>'sis')
    returning id_paciente into v_pac;
    insert into public.historia_clinica (id_paciente, numero_historia, antecedentes_patologicos, alergias_medicamentosas)
    values (v_pac, r->>'hc', nullif(r->>'ant', ''), nullif(r->>'alg', ''));
  end loop;

  for r in select * from jsonb_array_elements(coalesce(cambios->'thresholds', '[]')) loop
    perform sgc_interno.guardar_umbrales(r->'vals', r->>'by', sgc_interno.ts((r->>'since')::bigint));
  end loop;

  for r in select * from jsonb_array_elements(coalesce(cambios->'turns', '[]')) loop
    select p.id_paciente, h.id_historia into v_pac, v_hist
      from public.paciente p join public.historia_clinica h using (id_paciente)
     where p.tipo_documento = 'DNI' and p.numero_documento = r->>'dni';
    v_usr := sgc_interno.id_usuario(r->>'adm');
    if v_pac is null or v_usr is null then
      raise exception 'Datos de demostración incompletos en el turno %.', r->>'id' using errcode = 'P0001';
    end if;
    v_estado := case when r->>'state' in ('LLAMADO_TRIAJE','LLAMADO_CONSULTA') then 'LLAMANDO' else r->>'state' end;
    insert into public.turno (fecha_turno, codigo_turno, id_paciente, id_usuario_admision, hora_llegada, estado,
                              nivel_prioridad, id_area_destino, ts_inicio_triaje, ts_fin_triaje,
                              ts_llamado_consulta, ts_cierre, motivo_cancelacion, ts_ultimo_llamado,
                              veces_llamado, id_usuario_en_atencion)
    values ((sgc_interno.ts((r->>'t0')::bigint) at time zone 'America/Lima')::date, r->>'id', v_pac, v_usr,
            sgc_interno.ts((r->>'t0')::bigint), v_estado, coalesce(r->>'prio', 'NORMAL'),
            sgc_interno.id_area(r->>'dest', true), sgc_interno.ts((r->>'tTriCall')::bigint),
            sgc_interno.ts((r->>'tTriSave')::bigint), sgc_interno.ts((r->>'tMedCall')::bigint),
            case when r->>'state' = 'CANCELADO' then sgc_interno.ts((r->'cancel'->>'t')::bigint)
                 else sgc_interno.ts((r->>'tEnd')::bigint) end,
            left(r->'cancel'->>'motivo', 100), sgc_interno.ts((r->>'calledAt')::bigint),
            coalesce((r->>'calls')::int, 0),
            case r->>'state' when 'EN_TRIAJE' then sgc_interno.id_usuario(r->>'enf')
                             when 'EN_CONSULTA' then sgc_interno.id_usuario(r->>'med') end)
    returning id_turno into v_turno;

    if jsonb_typeof(r->'pago') = 'object' then
      perform sgc_interno.guardar_pago(v_turno, r->'pago', sgc_interno.id_usuario(r->'pago'->>'by'),
                                       sgc_interno.ts((r->'pago'->>'t')::bigint));
    end if;
    if jsonb_typeof(r->'tri') = 'object' then
      perform sgc_interno.guardar_signos(v_turno, r->'tri', sgc_interno.id_usuario(r->>'enf'),
                                         coalesce(sgc_interno.ts((r->>'tTriSave')::bigint), now()), r->>'prio');
    end if;
    if jsonb_typeof(r->'cita') = 'object' then
      perform sgc_interno.guardar_cita(v_turno, r->'cita', sgc_interno.id_usuario(r->'cita'->>'by'), r->>'prio', false);
      update public.cita set ts_llegada = sgc_interno.ts((r->>'llego')::bigint) where id_turno = v_turno;
      if r->>'state' in ('ATENDIDO','CANCELADO') then
        perform sgc_interno.cerrar_cita(v_turno, r->>'state', r->'cancel'->>'motivo');
      end if;
    end if;
    if jsonb_typeof(r->'consult') = 'object' then
      perform sgc_interno.guardar_atencion(v_turno, v_hist, r->'consult',
                                           sgc_interno.id_usuario(coalesce(r->'consult'->'medico'->>'u', r->>'med')),
                                           sgc_interno.id_area(r->'consult'->>'area', true),
                                           sgc_interno.ts((r->'consult'->>'t')::bigint), r->'tri'->>'motivo');
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(cambios->'audit', '[]')) loop
    v_usr := sgc_interno.id_usuario(r->>'u');
    continue when v_usr is null;
    perform sgc_interno.guardar_auditoria(v_usr, r->>'a', r->>'d',
              coalesce(nullif(r->>'ip', ''), '0.0.0.0')::inet, sgc_interno.ts((r->>'t')::bigint), r->>'id');
  end loop;
end $$;

-- =====================================================================
-- Cuentas y datos iniciales
-- =====================================================================
insert into public.usuario (username, password_hash, rol, nombre_completo, colegiatura, activo, id_especialidad)
select x.usr, 'pendiente', x.rol, x.nombre, x.col, x.act, e.id_especialidad
from (values
  ('a.admision',  'ADMISION',   'Carla Vidal (demo)',     null,        true,  null),
  ('c.caja',      'CAJA',       'Rocío Tello (demo)',     null,        true,  null),
  ('e.triaje',    'ENFERMERIA', 'Pedro Luna (demo)',      'CEP-00000', true,  null),
  ('m.consulta',  'MEDICO',     'Dra. Elena Ríos (demo)', 'CMP-00000', true,  'MG'),
  ('m.consulta2', 'MEDICO',     'Dr. Luis Paz (demo)',    'CMP-00001', true,  'MG'),
  ('m.pediatria', 'MEDICO',     'Dra. Sofía Mora (demo)', 'CMP-00002', true,  'PED'),
  ('m.cardio',    'MEDICO',     'Dr. Raúl Vega (demo)',   'CMP-00003', true,  'CAR'),
  ('m.general3',  'MEDICO',     'Dra. Patricia Núñez (demo)', 'CMP-00004', true, 'MG'),
  ('m.pediatria2','MEDICO',     'Dr. Andrés Salas (demo)', 'CMP-00005', true,  'PED'),
  ('a.admision2', 'ADMISION',   'Jorge Huamán (demo)',    null,        true,  null),
  ('c.caja2',     'CAJA',       'Lucía Paredes (demo)',   null,        true,  null),
  ('e.triaje2',   'ENFERMERIA', 'Ana Quispe (demo)',      'CEP-00002', true,  null),
  ('m.gineco',    'MEDICO',     'Dra. Carmen Salazar (demo)', 'CMP-00006', true, 'GIN'),
  ('m.general4',  'MEDICO',     'Dr. Hugo Medina (demo)', 'CMP-00007', true,  'MG'),
  ('a.admision3', 'ADMISION',   'Elsa Chávez (demo)',     null,        true,  null),
  ('c.caja3',     'CAJA',       'Martín Rojas (demo)',    null,        true,  null),
  ('e.triaje3',   'ENFERMERIA', 'Luis Vargas (demo)',     'CEP-00003', true,  null),
  ('j.calidad',   'JEFATURA',   'Silvia Torres (demo)',   null,        true,  null),
  ('j.jefatura',  'JEFATURA',   'Marco Soto (demo)',      null,        true,  null),
  ('m.familiar',  'MEDICO',     'Dr. Ernesto Llanos (demo)', 'CMP-00013', true, 'MF'),
  ('m.interna',   'MEDICO',     'Dra. Liliana Pacheco (demo)', 'CMP-00014', true, 'MI'),
  ('m.obstetra',  'MEDICO',     'Obst. Milagros Cárdenas (demo)', 'COP-00001', true, 'OBS'),
  ('m.cred',      'MEDICO',     'Lic. Enf. Judith Arce (demo)', 'CEP-00006', true, 'CRED'),
  ('m.odonto',    'MEDICO',     'C.D. Renato Valdivia (demo)', 'COP-10001', true, 'ODO'),
  ('m.odonto2',   'MEDICO',     'C.D. Andrea Monzón (demo)', 'COP-10002', true, 'ODO'),
  ('m.psicologia','MEDICO',     'Ps. Diana Ugaz (demo)',  'CPsP-00001', true, 'PSI'),
  ('m.nutricion', 'MEDICO',     'Lic. Nut. Pablo Herrera (demo)', 'CNP-00001', true, 'NUT'),
  ('e.turno2',    'ENFERMERIA', 'Iris Campos (demo)',     'CEP-00001', false, null)
) as x(usr, rol, nombre, col, act, esp)
left join public.especialidad e on e.codigo = x.esp;

-- Horario semanal de la demostración (el mismo de src/lib/seedHistory.js): Medicina General de mañana
-- (dos médicos) y de tarde, Pediatría lunes, miércoles y viernes (mañana y tarde), Cardiología martes y jueves
-- y Ginecología y Obstetricia lunes, miércoles y viernes por la mañana.
insert into public.horario_medico (id_usuario_medico, id_area, dia_semana, hora_inicio, hora_fin)
select u.id_usuario, a.id_area, d.dia, x.ini, x.fin
from (values
  ('m.consulta',  'Consultorio 1', time '07:00', time '13:00', array[1,2,3,4,5,6]),
  ('m.consulta2', 'Consultorio 1', time '13:00', time '19:00', array[1,2,3,4,5]),
  ('m.pediatria', 'Consultorio 2', time '08:00', time '14:00', array[1,3,5]),
  ('m.cardio',    'Consultorio 2', time '08:00', time '13:00', array[2,4]),
  ('m.general3',  'Consultorio 3', time '07:00', time '13:00', array[1,2,3,4,5]),
  ('m.pediatria2','Consultorio 3', time '14:00', time '19:00', array[1,3,5]),
  ('m.gineco',    'Consultorio 4', time '08:00', time '13:00', array[1,3,5]),
  ('m.general4',  'Consultorio 4', time '13:00', time '19:00', array[2,4]),
  ('m.general4',  'Consultorio 4', time '08:00', time '13:00', array[6]),
  ('m.familiar',  'Consultorio 5', time '07:00', time '13:00', array[1,2,3,4,5]),
  ('m.interna',   'Consultorio 5', time '13:00', time '19:00', array[1,2,3,4,5]),
  ('m.obstetra',  'Consultorio 6', time '07:00', time '13:00', array[1,2,3,4,5,6]),
  ('m.cred',      'Consultorio 6', time '13:00', time '18:00', array[1,2,3,4,5]),
  ('m.odonto',    'Consultorio 7', time '07:00', time '13:00', array[1,2,3,4,5,6]),
  ('m.odonto2',   'Consultorio 7', time '13:00', time '19:00', array[1,2,3,4,5]),
  ('m.psicologia','Consultorio 8', time '08:00', time '14:00', array[1,2,3,4,5]),
  ('m.nutricion', 'Consultorio 8', time '14:00', time '19:00', array[1,2,3,4,5])
) as x(usr, area, ini, fin, dias)
join public.usuario u on u.username = x.usr
join public.area_atencion a on a.nombre = x.area
cross join lateral unnest(x.dias) as d(dia);

-- Contraseña de las cuentas de demostración: Demo2026 (cámbiela desde la app)
select sgc_interno.fijar_credencial(username, 'Demo2026', false) from public.usuario;

-- Autor de las citas que el paciente reserva por la web. No tiene cuenta en Supabase Auth: no puede iniciar sesión.
insert into public.usuario (username, password_hash, rol, nombre_completo, activo)
values ('a.citasweb', 'sin-acceso', 'ADMISION', 'Citas por web (sistema)', false);

-- Umbrales iniciales (valores de demostración, a validar por el responsable clínico)
select sgc_interno.guardar_umbrales(
  '{"spo2":90,"spo2A":93,"tmp":40,"tmpA":38.5,"pasLo":80,"pasA":180,"fcHi":130,"fcA":110,"frHi":30,"frA":25}'::jsonb,
  'Dra. Elena Ríos (demo)', now());

-- =====================================================================
-- API para la app (Supabase la expone como /rest/v1/rpc/...)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Turnos en el formato de la app. Se ejecuta con los permisos de quien llama
-- (RLS): cada rol recibe solo las columnas y tablas que puede ver.
--   p_dni nulo   → turnos de trabajo: desde p_desde o todavía abiertos.
--   p_dni dado   → todas las atenciones de ese paciente (historia).
-- ---------------------------------------------------------------------
create function sgc_interno.turnos_json(p_desde date, p_dni text) returns jsonb
language sql stable security invoker set search_path = '' as $$
select coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', t.codigo_turno, 'dni', p.numero_documento, 'adm', ua.username,
      'state', sgc_interno.estado_app(t.estado, t.ts_fin_triaje),
      'prio', case when t.ts_fin_triaje is null then null else t.nivel_prioridad end,
      't0', sgc_interno.ms(t.hora_llegada), 'tTriCall', sgc_interno.ms(t.ts_inicio_triaje),
      'tTriSave', sgc_interno.ms(t.ts_fin_triaje), 'tMedCall', sgc_interno.ms(t.ts_llamado_consulta),
      'tEnd', case when t.estado = 'ATENDIDO' then sgc_interno.ms(t.ts_cierre) end,
      'calledAt', sgc_interno.ms(t.ts_ultimo_llamado),
      'calls', nullif(t.veces_llamado, 0),
      'tPago', sgc_interno.ms(pg.fecha_pago),
      'pago', case when pg.id_pago is not null then jsonb_build_object(
                'metodo', pg.metodo_pago, 'monto', pg.monto, 'comp', pg.numero_comprobante,
                'by', upg.username, 't', sgc_interno.ms(pg.fecha_pago)) end,
      'tCita', sgc_interno.ms(ci.fecha_registro),
      'cita', case when ci.id_cita is not null then jsonb_build_object(
                'esp', es.codigo, 'med', uci.username, 'area', aci.nombre,
                'at', sgc_interno.ms((ci.fecha_cita + ci.hora_cita) at time zone 'America/Lima'),
                'sobre', ci.es_sobrecupo, 'by', ucr.username, 't', sgc_interno.ms(ci.fecha_registro)) end,
      'llego', sgc_interno.ms(ci.ts_llegada),
      -- La espera de consulta empieza a la hora de la cita o al llegar, lo que sea posterior
      'tLlega', case when ci.ts_llegada is not null then sgc_interno.ms(
                greatest(ci.ts_llegada, (ci.fecha_cita + ci.hora_cita) at time zone 'America/Lima')) end,
      'dest', ar.nombre,
      'enf', coalesce(ue.username, case when t.estado = 'EN_TRIAJE' then uat.username end),
      'med', coalesce(um.username, case when t.estado = 'EN_CONSULTA' then uat.username end),
      'cancel', case when t.estado = 'CANCELADO' then jsonb_build_object(
                  'motivo', t.motivo_cancelacion, 't', sgc_interno.ms(t.ts_cierre)) end,
      'tri', case when sv.id_signos is not null then jsonb_build_object(
                'pa', sv.presion_sistolica || '/' || sv.presion_diastolica,
                'fc', sv.pulso, 'fr', sv.frecuencia_resp, 't', sv.temperatura,
                'spo2', sv.saturacion_spo2, 'peso', sv.peso_kg, 'talla', sv.talla_m,
                'motivo', sv.motivo_triaje)
             else (select jsonb_build_object('motivo', m) from sgc_interno.motivo_triaje(t.id_turno) m where m is not null) end,
      'consult', case when am.id_atencion is not null then jsonb_build_object(
                'notas', am.examen_clinico,
                'dx', coalesce((select jsonb_agg(jsonb_build_array(d.codigo_cie10, c.descripcion,
                                  case d.tipo_diagnostico when 'DEFINITIVO' then 'D' else 'P' end)
                                  order by d.tipo_diagnostico, d.codigo_cie10)
                                from public.atencion_diagnostico d
                                join public.diagnostico_cie10 c on c.codigo_cie10 = d.codigo_cie10
                                where d.id_atencion = am.id_atencion), '[]'::jsonb),
                'meds', coalesce((select jsonb_agg(jsonb_build_object(
                                  'n', dr.medicamento, 'dosis', dr.dosis, 'frec', dr.frecuencia,
                                  'dias', dr.duracion_dias,
                                  'cant', coalesce(dr.cantidad_solicitada::text, ''))
                                  order by dr.medicamento)
                                from public.detalle_receta dr where dr.id_receta = rm.id_receta), '[]'::jsonb),
                'dest', case am.destino_alta when 'ALTA' then 'Alta' when 'REPOSO' then 'Reposo médico'
                                             else 'Derivación a hospital' end,
                'destx', coalesce(am.detalle_destino, ''),
                'rec', rm.codigo_receta,
                't', sgc_interno.ms(am.fecha_atencion),
                'area', aa.nombre,
                'medico', jsonb_build_object('u', um.username, 'n', um.nombre_completo,
                                             'col', coalesce(um.colegiatura, ''))) end
    )) order by t.hora_llegada)
    from public.turno t
    left join public.paciente p on p.id_paciente = t.id_paciente
    left join public.usuario ua on ua.id_usuario = t.id_usuario_admision
    left join public.area_atencion ar on ar.id_area = t.id_area_destino
    left join public.usuario uat on uat.id_usuario = t.id_usuario_en_atencion
    left join public.signos_vitales sv on sv.id_turno = t.id_turno
    left join public.usuario ue on ue.id_usuario = sv.id_usuario_enfermero
    left join public.atencion_medica am on am.id_turno = t.id_turno
    left join public.usuario um on um.id_usuario = am.id_usuario_medico
    left join public.area_atencion aa on aa.id_area = am.id_area
    left join public.receta_medica rm on rm.id_atencion = am.id_atencion
    left join public.pago pg on pg.id_turno = t.id_turno
    left join public.usuario upg on upg.id_usuario = pg.id_usuario_cajero
    left join public.cita ci on ci.id_turno = t.id_turno
    left join public.especialidad es on es.id_especialidad = ci.id_especialidad
    left join public.usuario uci on uci.id_usuario = ci.id_usuario_medico
    left join public.area_atencion aci on aci.id_area = ci.id_area
    left join public.usuario ucr on ucr.id_usuario = ci.id_usuario_registro
    where case when p_dni is null
               then t.fecha_turno >= p_desde or t.estado not in ('ATENDIDO','CANCELADO')
               else p.tipo_documento = 'DNI' and p.numero_documento = p_dni end), '[]'::jsonb)
$$;

-- ---------------------------------------------------------------------
-- sgc_cargar(): datos en el formato de la app. Se ejecuta con los permisos
-- de quien llama: cada rol recibe solo lo que sus políticas RLS le dejan ver.
-- ---------------------------------------------------------------------
create function public.sgc_cargar() returns jsonb
language sql stable security invoker set search_path = '' as $$
select jsonb_build_object(
  'me', (select to_jsonb(x) from sgc_interno.usuario_actual() x where x.id_usuario is not null),
  'users', coalesce((
    select jsonb_agg(jsonb_build_object(
      'u', u.username, 'n', u.nombre_completo,
      'role', case u.rol when 'ADMISION' then 'adm' when 'CAJA' then 'caj' when 'ENFERMERIA' then 'enf'
                         when 'MEDICO' then 'med' else 'jef' end,
      'col', coalesce(u.colegiatura, ''), 'on', u.activo, 'esp', e.codigo) order by u.creado_en, u.username)
    from public.usuario u left join public.especialidad e on e.id_especialidad = u.id_especialidad), '[]'::jsonb),

  -- Horario semanal de los médicos: con él la app calcula los cupos de cita
  'horarios', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', h.id_horario, 'med', u.username, 'dow', h.dia_semana,
      'ini', to_char(h.hora_inicio, 'HH24:MI'), 'fin', to_char(h.hora_fin, 'HH24:MI'),
      'area', a.nombre, 'on', h.activo) order by u.username, h.dia_semana, h.hora_inicio)
    from public.horario_medico h
    join public.usuario u on u.id_usuario = h.id_usuario_medico
    join public.area_atencion a on a.id_area = h.id_area), '[]'::jsonb),

  'patients', coalesce((
    select jsonb_agg(jsonb_build_object(
      'dni', p.numero_documento, 'nom', p.nombres, 'ape', p.apellidos,
      'nac', to_char(p.fecha_nacimiento, 'YYYY-MM-DD'), 'sexo', p.sexo,
      'tel', coalesce(p.telefono, ''), 'sis', p.condicion_sis, 'hc', h.numero_historia,
      'ant', coalesce(sgc_interno.antecedentes(h.id_historia), ''), 'alg', coalesce(h.alergias_medicamentosas, ''))
      order by h.numero_historia)
    from public.paciente p join public.historia_clinica h on h.id_paciente = p.id_paciente), '[]'::jsonb),

  'turns', sgc_interno.turnos_json((now() at time zone 'America/Lima')::date, null),
  -- Último número de receta del año (solo lo ve Medicina, que es quien emite recetas)
  'meta', jsonb_build_object('recMax', (
    select max(substring(rm.codigo_receta from '^REC-\d{4}-(\d+)$')::int) from public.receta_medica rm
    where rm.codigo_receta like 'REC-' || extract(year from now() at time zone 'America/Lima')::int || '-%'),
    -- Último número de boleta (cada caja continúa el correlativo)
    'compMax', (select max(substring(pg.numero_comprobante from '^B001-(\d+)$')::int) from public.pago pg)),

  'audit', coalesce((
    select jsonb_agg(x.o order by x.f desc) from (
      select a.fecha_hora f, jsonb_build_object(
        'id', a.id_auditoria, 't', sgc_interno.ms(a.fecha_hora), 'u', u.username,
        'a', coalesce(a.valores_nuevos->>'accion', a.operacion),
        'd', coalesce(a.valores_nuevos->>'detalle', a.tabla_afectada),
        'ip', host(a.direccion_ip)) o
      from public.auditoria a join public.usuario u on u.id_usuario = a.id_usuario
      order by a.fecha_hora desc limit 500) x), '[]'::jsonb),

  'thresholds', coalesce((
    select jsonb_agg(jsonb_build_object('id', 'umb-' || sgc_interno.ms(v.desde), 'vals', v.vals,
                                        'by', v.por, 'since', sgc_interno.ms(v.desde)) order by v.desde)
    from (select uc.vigente_desde desde,
                 jsonb_object_agg(m.clave, uc.valor_umbral) vals,
                 min(u.nombre_completo) por
          from public.umbral_clinico uc
          join sgc_interno.mapa_umbral() m on m.parametro = uc.parametro and m.nivel = uc.nivel
          join public.usuario u on u.id_usuario = uc.id_usuario_aprobador
          group by uc.vigente_desde) v), '[]'::jsonb)
);
$$;

-- ---------------------------------------------------------------------
-- sgc_guardar(cambios): guarda los cambios de UNA acción en una transacción.
-- Valida la sesión, el rol, la máquina de estados y los datos. El autor, la
-- hora y la IP de cada evento los pone el servidor, no el navegador.
-- ---------------------------------------------------------------------
create function public.sgc_guardar(cambios jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo record; r jsonb; tri jsonb;
  v_pac uuid; v_hist uuid; v_turno uuid; t record;
  v_desde text; v_hacia text; v_area uuid; v_area_tipo text; v_prio text; v_pa text[];
  v_exon boolean; v_fecha date;
begin
  select * into yo from sgc_interno.usuario_actual();
  if yo.id_usuario is null then
    raise exception 'Sesión no válida o usuario desactivado. Vuelva a iniciar sesión.' using errcode = '42501';
  end if;

  -- Usuarios (solo Jefatura) ------------------------------------------
  if jsonb_array_length(coalesce(cambios->'users', '[]')) > 0 and yo.rol <> 'JEFATURA' then
    raise exception 'Solo Jefatura puede administrar usuarios.' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(coalesce(cambios->'users', '[]')) loop
    if r->>'u' = yo.username and coalesce((r->>'on')::boolean, true) = false then
      raise exception 'No puede desactivar su propio usuario.' using errcode = 'P0001';
    end if;
    insert into public.usuario (username, password_hash, rol, nombre_completo, colegiatura, activo, id_especialidad)
    values (r->>'u', 'pendiente',
            case r->>'role' when 'adm' then 'ADMISION' when 'caj' then 'CAJA' when 'enf' then 'ENFERMERIA'
                            when 'med' then 'MEDICO' else 'JEFATURA' end,
            r->>'n', nullif(r->>'col', ''), coalesce((r->>'on')::boolean, true),
            case when r->>'role' = 'med' then (select id_especialidad from public.especialidad where codigo = r->>'esp') end)
    on conflict (username) do update
      set rol = excluded.rol, nombre_completo = excluded.nombre_completo,
          colegiatura = excluded.colegiatura, activo = excluded.activo,
          id_especialidad = coalesce(excluded.id_especialidad, public.usuario.id_especialidad);
    if coalesce(r->>'clave_temporal', '') <> '' then
      perform sgc_interno.fijar_credencial(r->>'u', r->>'clave_temporal', true);
    elsif (select password_hash from public.usuario where username = r->>'u') = 'pendiente' then
      raise exception 'Falta la contraseña temporal del usuario nuevo.' using errcode = 'P0001';
    end if;
  end loop;
  if exists (select 1 from public.usuario where rol = 'JEFATURA') and
     not exists (select 1 from public.usuario where rol = 'JEFATURA' and activo) then
    raise exception 'Debe quedar al menos un usuario de Jefatura activo.' using errcode = 'P0001';
  end if;

  -- Pacientes: Admisión registra y actualiza; Enfermería solo alergias ----
  if jsonb_array_length(coalesce(cambios->'patients', '[]')) > 0 and yo.rol not in ('ADMISION','ENFERMERIA') then
    raise exception 'Su rol no puede modificar datos de pacientes.' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(coalesce(cambios->'patients', '[]')) loop
    if yo.rol = 'ENFERMERIA' then
      update public.historia_clinica h set alergias_medicamentosas = nullif(r->>'alg', '')
        from public.paciente p
       where p.id_paciente = h.id_paciente and p.tipo_documento = 'DNI' and p.numero_documento = r->>'dni';
      continue;
    end if;
    insert into public.paciente (tipo_documento, numero_documento, nombres, apellidos,
                                 fecha_nacimiento, sexo, telefono, condicion_sis)
    values ('DNI', r->>'dni', r->>'nom', r->>'ape', (r->>'nac')::date, r->>'sexo',
            nullif(r->>'tel', ''), r->>'sis')
    on conflict (tipo_documento, numero_documento) do update
      set nombres = excluded.nombres, apellidos = excluded.apellidos,
          fecha_nacimiento = excluded.fecha_nacimiento, sexo = excluded.sexo,
          telefono = excluded.telefono, condicion_sis = excluded.condicion_sis,
          fecha_validacion_sis = case when excluded.condicion_sis = 'ACTIVO' then now() end
    returning id_paciente into v_pac;
    insert into public.historia_clinica (id_paciente, numero_historia, antecedentes_patologicos, alergias_medicamentosas)
    values (v_pac, r->>'hc', nullif(r->>'ant', ''), nullif(r->>'alg', ''))
    on conflict (id_paciente) do nothing;
  end loop;

  -- Umbrales (solo Jefatura, aprobados por un médico) ------------------
  if jsonb_array_length(coalesce(cambios->'thresholds', '[]')) > 0 and yo.rol <> 'JEFATURA' then
    raise exception 'Solo Jefatura registra umbrales clínicos.' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(coalesce(cambios->'thresholds', '[]')) loop
    perform sgc_interno.guardar_umbrales(r->'vals', r->>'by', now());
  end loop;

  -- Horarios de los médicos (solo Jefatura) ------------------------------
  if jsonb_array_length(coalesce(cambios->'horarios', '[]')) > 0 and yo.rol <> 'JEFATURA' then
    raise exception 'Solo Jefatura administra los horarios médicos.' using errcode = '42501';
  end if;
  for r in select * from jsonb_array_elements(coalesce(cambios->'horarios', '[]')) loop
    perform sgc_interno.guardar_horario(r);
  end loop;

  -- Turnos -------------------------------------------------------------
  for r in select * from jsonb_array_elements(coalesce(cambios->'turns', '[]')) loop
    v_hacia := r->>'state';
    select p.id_paciente, h.id_historia into v_pac, v_hist
      from public.paciente p join public.historia_clinica h using (id_paciente)
     where p.tipo_documento = 'DNI' and p.numero_documento = r->>'dni';

    select tu.*, sgc_interno.estado_app(tu.estado, tu.ts_fin_triaje) estado_app, ar.tipo area_tipo, ar.nombre area_nombre
      into t
      from public.turno tu left join public.area_atencion ar on ar.id_area = tu.id_area_destino
     where tu.codigo_turno = r->>'id'
       -- el código se reinicia cada día: se busca entre los turnos de hoy y los que siguen abiertos
       and (tu.fecha_turno = (now() at time zone 'America/Lima')::date or tu.estado not in ('ATENDIDO','CANCELADO'))
     order by tu.fecha_turno desc limit 1
     for update of tu;

    if t.id_turno is null then
      -- Turno nuevo: solo Admisión. Con SIS se exonera el pago y pasa a triaje; sin seguro, a Caja.
      if yo.rol <> 'ADMISION' then
        raise exception 'Solo Admisión puede generar turnos.' using errcode = '42501';
      end if;
      if v_pac is null then
        raise exception 'El paciente con DNI % no está registrado.', r->>'dni' using errcode = 'P0001';
      end if;
      v_exon := sgc_interno.exonerado((select condicion_sis from public.paciente where id_paciente = v_pac));
      if v_hacia is distinct from (case when v_exon then 'EN_ESPERA_TRIAJE' else 'PENDIENTE_PAGO' end) then
        raise exception 'Un turno nuevo empieza %.',
          case when v_exon then 'en espera de triaje (SIS: no paga)' else 'pendiente de pago en Caja' end using errcode = 'P0001';
      end if;
      insert into public.turno (fecha_turno, codigo_turno, id_paciente, id_usuario_admision, hora_llegada, estado)
      values (sgc_interno.hoy(), r->>'id', v_pac, yo.id_usuario, now(), v_hacia)
      returning id_turno into v_turno;
      if v_exon then
        perform sgc_interno.guardar_pago(v_turno, '{"metodo": "SIS", "monto": 0}'::jsonb, yo.id_usuario, now());
      end if;
      continue;
    end if;

    v_desde := t.estado_app;
    if v_pac is not null and v_pac <> t.id_paciente then
      raise exception 'El código % ya se asignó a otro paciente. Actualice la página e intente de nuevo.', r->>'id'
        using errcode = 'P0001';
    end if;
    if not sgc_interno.transicion_valida(v_desde, v_hacia) then
      raise exception 'El turno % cambió de estado en otra estación (%). Actualice la lista.', r->>'id', v_desde
        using errcode = 'P0001';
    end if;
    if not sgc_interno.rol_puede(yo.rol, v_desde, v_hacia) then
      raise exception 'Su rol no puede pasar el turno % de % a %.', r->>'id', v_desde, v_hacia using errcode = '42501';
    end if;
    -- Cada médico llama y atiende solo a los pacientes que tienen cita con él
    if yo.rol = 'MEDICO' and exists (select 1 from public.cita c
                                     where c.id_turno = t.id_turno and c.id_usuario_medico <> yo.id_usuario) then
      raise exception 'El turno % tiene cita con otro médico.', r->>'id' using errcode = '42501';
    end if;

    case v_hacia
    when 'LLAMADO_TRIAJE', 'LLAMADO_CONSULTA' then
      select id_area, tipo into v_area, v_area_tipo from public.area_atencion where nombre = r->>'dest' and activo;
      if v_area is null or v_area_tipo <> (array['TRIAJE','CONSULTORIO'])[(v_hacia = 'LLAMADO_CONSULTA')::int + 1] then
        raise exception 'Destino de llamado no válido: %', r->>'dest' using errcode = 'P0001';
      end if;
      if v_desde = v_hacia and v_hacia = 'LLAMADO_CONSULTA' and v_area <> t.id_area_destino then
        raise exception '% ya fue llamado a %.', r->>'id', t.area_nombre using errcode = 'P0001';
      end if;
      -- CR-06: no se llama a otro paciente mientras el consultorio tiene una atención abierta
      if v_hacia = 'LLAMADO_CONSULTA' and exists (select 1 from public.turno o
                                                  where o.estado = 'EN_CONSULTA' and o.id_area_destino = v_area
                                                    and o.id_turno <> t.id_turno) then
        raise exception 'Termine o devuelva la atención abierta en % antes de llamar a otro paciente.', r->>'dest'
          using errcode = 'P0001';
      end if;
      update public.turno set estado = 'LLAMANDO', id_area_destino = v_area,
             ts_ultimo_llamado = now(), veces_llamado = veces_llamado + 1,
             ts_inicio_triaje    = case when v_hacia = 'LLAMADO_TRIAJE' then coalesce(ts_inicio_triaje, now()) else ts_inicio_triaje end,
             ts_llamado_consulta = case when v_hacia = 'LLAMADO_CONSULTA' then coalesce(ts_llamado_consulta, now()) else ts_llamado_consulta end
       where id_turno = t.id_turno;

    when 'EN_TRIAJE' then
      update public.turno set estado = 'EN_TRIAJE', id_usuario_en_atencion = yo.id_usuario
       where id_turno = t.id_turno;

    when 'EN_CONSULTA' then
      update public.turno set estado = 'EN_CONSULTA', id_usuario_en_atencion = yo.id_usuario
       where id_turno = t.id_turno;

    when 'PENDIENTE_PAGO' then
      -- Llegada de quien reservó su cita (sin seguro): primero paga en Caja
      perform sgc_interno.llegada_reserva(t.id_turno, false);
      update public.turno set estado = 'PENDIENTE_PAGO', hora_llegada = now() where id_turno = t.id_turno;

    when 'EN_ESPERA_TRIAJE' then
      if v_desde = 'CITADO' then
        -- Llegada de quien reservó su cita (con SIS): no paga y pasa a triaje
        perform sgc_interno.llegada_reserva(t.id_turno, true);
        perform sgc_interno.guardar_pago(t.id_turno, '{"metodo": "SIS", "monto": 0}'::jsonb, yo.id_usuario, now());
        update public.turno set estado = 'EN_ESPERA_TRIAJE', hora_llegada = now() where id_turno = t.id_turno;
      elsif v_desde = 'PENDIENTE_PAGO' then
        -- Cobro en Caja: la tarifa la fija la base; el medio de pago y la boleta se validan
        if coalesce(r->'pago'->>'metodo', '') not in ('EFECTIVO','TARJETA','BILLETERA') then
          raise exception 'Medio de pago no válido.' using errcode = 'P0001';
        end if;
        if coalesce(r->'pago'->>'comp', '') !~ '^B001-[0-9]{6}$' then
          raise exception 'Número de boleta no válido.' using errcode = 'P0001';
        end if;
        perform sgc_interno.guardar_pago(t.id_turno, jsonb_build_object('metodo', r->'pago'->>'metodo',
                  'monto', sgc_interno.tarifa(), 'comp', r->'pago'->>'comp'), yo.id_usuario, now());
        update public.turno set estado = 'EN_ESPERA_TRIAJE' where id_turno = t.id_turno;
      else                          -- devuelto a la lista desde triaje
        update public.turno set estado = 'EN_ESPERA_TRIAJE', id_usuario_en_atencion = null, ts_ultimo_llamado = null
         where id_turno = t.id_turno;
      end if;

    when 'PENDIENTE_CITA' then
        -- Fin del triaje: la base valida los signos y calcula la prioridad
        tri := r->'tri';
        if jsonb_typeof(tri) <> 'object' then
          raise exception 'Faltan los signos vitales del triaje.' using errcode = 'P0001';
        end if;
        v_pa := regexp_match(tri->>'pa', '^\s*(\d{2,3})\s*/\s*(\d{2,3})\s*$');
        if v_pa is null then
          raise exception 'Presión arterial no válida: %', tri->>'pa' using errcode = 'P0001';
        end if;
        v_prio := sgc_interno.prioridad(v_pa[1]::numeric, (tri->>'fc')::numeric, (tri->>'fr')::numeric,
                                        (tri->>'t')::numeric, (tri->>'spo2')::numeric);
        perform sgc_interno.guardar_signos(t.id_turno, tri, yo.id_usuario, now(), v_prio);
        update public.turno set estado = 'PENDIENTE_CITA', nivel_prioridad = v_prio, ts_fin_triaje = now(),
               id_usuario_en_atencion = null, ts_ultimo_llamado = null
         where id_turno = t.id_turno;

    when 'CITADO' then
      -- Cita para otro día (o reprogramación): el paciente vuelve ese día
      v_fecha := sgc_interno.guardar_cita(t.id_turno, r->'cita', yo.id_usuario, t.nivel_prioridad, true);
      if v_desde = 'PENDIENTE_CITA' and v_fecha = sgc_interno.hoy() then
        raise exception 'Con cita para hoy, el paciente pasa a la espera de consulta.' using errcode = 'P0001';
      end if;
      update public.turno set estado = 'CITADO' where id_turno = t.id_turno;

    when 'EN_ESPERA_CONSULTA' then
      if v_desde = 'PENDIENTE_CITA' then
        -- Cita para hoy: el paciente ya está en el centro
        v_fecha := sgc_interno.guardar_cita(t.id_turno, r->'cita', yo.id_usuario, t.nivel_prioridad, true);
        if v_fecha <> sgc_interno.hoy() then
          raise exception 'La cita no es para hoy: el turno queda citado.' using errcode = 'P0001';
        end if;
        update public.cita set ts_llegada = now() where id_turno = t.id_turno;
        update public.turno set estado = 'EN_ESPERA_CONSULTA' where id_turno = t.id_turno;
      elsif v_desde = 'EN_TRIAJE' then
        -- Fin del triaje de quien ya tiene cita para hoy (la reservó): pasa directo a la espera de su médico
        if (select fecha_cita from public.cita where id_turno = t.id_turno) is distinct from sgc_interno.hoy() then
          raise exception 'El turno % no tiene cita para hoy: debe recibirla al terminar el triaje.', r->>'id' using errcode = 'P0001';
        end if;
        tri := r->'tri';
        if jsonb_typeof(tri) <> 'object' then
          raise exception 'Faltan los signos vitales del triaje.' using errcode = 'P0001';
        end if;
        v_pa := regexp_match(tri->>'pa', '^\s*(\d{2,3})\s*/\s*(\d{2,3})\s*$');
        if v_pa is null then
          raise exception 'Presión arterial no válida: %', tri->>'pa' using errcode = 'P0001';
        end if;
        v_prio := sgc_interno.prioridad(v_pa[1]::numeric, (tri->>'fc')::numeric, (tri->>'fr')::numeric,
                                        (tri->>'t')::numeric, (tri->>'spo2')::numeric);
        perform sgc_interno.guardar_signos(t.id_turno, tri, yo.id_usuario, now(), v_prio);
        update public.cita set ts_llegada = now() where id_turno = t.id_turno;
        update public.turno set estado = 'EN_ESPERA_CONSULTA', nivel_prioridad = v_prio, ts_fin_triaje = now(),
               id_usuario_en_atencion = null, ts_ultimo_llamado = null
         where id_turno = t.id_turno;
      elsif v_desde = 'CITADO' then
        -- Llegada del paciente citado: solo el día de su cita
        if t.ts_fin_triaje is null then
          raise exception '% reservó su cita sin pasar por triaje: registre su llegada para que pase por Caja o triaje.', r->>'id'
            using errcode = 'P0001';
        end if;
        if (select fecha_cita from public.cita where id_turno = t.id_turno) is distinct from sgc_interno.hoy() then
          raise exception 'La llegada de % se registra el día de su cita.', r->>'id' using errcode = 'P0001';
        end if;
        update public.cita set ts_llegada = now() where id_turno = t.id_turno;
        update public.turno set estado = 'EN_ESPERA_CONSULTA' where id_turno = t.id_turno;
      else                          -- devuelto a la lista desde consulta
        update public.turno set estado = 'EN_ESPERA_CONSULTA', id_usuario_en_atencion = null, ts_ultimo_llamado = null
         where id_turno = t.id_turno;
      end if;

    when 'ATENDIDO' then
      if t.id_usuario_en_atencion is distinct from yo.id_usuario then
        raise exception 'Solo el médico que inició la atención puede cerrarla.' using errcode = '42501';
      end if;
      perform sgc_interno.guardar_atencion(t.id_turno, v_hist, r->'consult', yo.id_usuario, t.id_area_destino, now(),
                (select motivo_triaje from public.signos_vitales where id_turno = t.id_turno));
      update public.turno set estado = 'ATENDIDO', ts_cierre = now(), id_usuario_en_atencion = null, ts_ultimo_llamado = null
       where id_turno = t.id_turno;
      perform sgc_interno.cerrar_cita(t.id_turno, 'ATENDIDO', null);

    when 'CANCELADO' then
      if coalesce(trim(r->'cancel'->>'motivo'), '') = '' then
        raise exception 'Indique el motivo de la cancelación.' using errcode = 'P0001';
      end if;
      update public.turno set estado = 'CANCELADO', ts_cierre = now(), motivo_cancelacion = left(r->'cancel'->>'motivo', 100),
             id_usuario_en_atencion = null, ts_ultimo_llamado = null
       where id_turno = t.id_turno;
      perform sgc_interno.cerrar_cita(t.id_turno, 'CANCELADO', r->'cancel'->>'motivo');
    end case;
  end loop;

  -- Auditoría: el autor, la hora y la IP los fija el servidor --------------
  for r in select * from jsonb_array_elements(coalesce(cambios->'audit', '[]')) loop
    perform sgc_interno.guardar_auditoria(yo.id_usuario, r->>'a', r->>'d', sgc_interno.ip_cliente(), now(), r->>'id');
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- sgc_restablecer_demo(datos): borra los datos clínicos, carga la primera
-- parte del lote de demostración y abre una carga por partes de 10 minutos
-- (devuelve su token). sgc_restablecer_demo_lote(token, datos) agrega las
-- partes siguientes; la última envía "fin": true y cierra la carga.
-- Así ninguna petición es grande y la carga histórica solo es posible justo
-- después de borrar todo (no sirve para insertar historia en datos reales).
-- Las cuentas de usuario se conservan. Solo Jefatura.
-- ---------------------------------------------------------------------
create table sgc_interno.carga_demo (
    token      uuid        not null default gen_random_uuid() primary key,
    id_usuario uuid        not null,
    expira     timestamptz not null
);

create function public.sgc_restablecer_demo(datos jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_yo uuid; v_token uuid;
begin
  if sgc_interno.rol_actual() is distinct from 'JEFATURA' then
    raise exception 'Solo Jefatura puede restablecer los datos de demostración.' using errcode = '42501';
  end if;
  select id_usuario into v_yo from sgc_interno.usuario_actual();
  truncate public.auditoria, public.detalle_receta, public.receta_medica, public.atencion_diagnostico,
           public.atencion_medica, public.signos_vitales, public.cita, public.pago, public.turno,
           public.historia_clinica, public.paciente, public.umbral_clinico;
  delete from sgc_interno.carga_demo where true;  -- Supabase (pg_safeupdate) exige WHERE en los DELETE que llegan por la API
  perform sgc_interno.importar(datos);
  perform sgc_interno.guardar_auditoria(v_yo, 'DEMO', 'Datos de demostración restablecidos', sgc_interno.ip_cliente(), now());
  insert into sgc_interno.carga_demo (id_usuario, expira) values (v_yo, now() + interval '10 minutes')
  returning token into v_token;
  return v_token;
end $$;

create function public.sgc_restablecer_demo_lote(p_token uuid, datos jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if sgc_interno.rol_actual() is distinct from 'JEFATURA' then
    raise exception 'Solo Jefatura puede restablecer los datos de demostración.' using errcode = '42501';
  end if;
  if not exists (select 1 from sgc_interno.carga_demo c
                  where c.token = p_token and c.expira > now()
                    and c.id_usuario = (select id_usuario from sgc_interno.usuario_actual())) then
    raise exception 'La carga de demostración no está abierta o expiró. Vuelva a restablecer los datos.' using errcode = 'P0001';
  end if;
  perform sgc_interno.importar(datos - 'fin');
  if coalesce((datos->>'fin')::boolean, false) then
    delete from sgc_interno.carga_demo where token = p_token;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- sgc_historia(p_dni): atenciones previas de un paciente. Con los permisos
-- de quien llama: Enfermería recibe los signos vitales; Medicina, además,
-- diagnósticos y recetas. Los demás roles no pueden consultarla.
-- ---------------------------------------------------------------------
create function sgc_interno.auditar_historia(p_dni text) returns void
language sql security definer set search_path = '' as $$
  select sgc_interno.guardar_auditoria(
           (select id_usuario from sgc_interno.usuario_actual()), 'HC_CONSULTADA',
           coalesce((select h.numero_historia from public.historia_clinica h
                     join public.paciente p on p.id_paciente = h.id_paciente
                     where p.tipo_documento = 'DNI' and p.numero_documento = p_dni), 'DNI desconocido')
           || ' consultada (historia)',
           sgc_interno.ip_cliente(), now()) $$;

create function public.sgc_historia(p_dni text) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
begin
  if coalesce(sgc_interno.rol_actual(), '') not in ('ENFERMERIA','MEDICO') then
    raise exception 'Su rol no puede consultar historias clínicas.' using errcode = '42501';
  end if;
  -- Cada lectura de la historia queda auditada aquí, no depende de la app
  perform sgc_interno.auditar_historia(p_dni);
  return sgc_interno.turnos_json(null, p_dni);
end $$;

-- ---------------------------------------------------------------------
-- sgc_clave_cambiada(): se llama después de cambiar la contraseña en Supabase
-- Auth. Si la cuenta tenía una clave temporal, comprueba que el hash ya no es
-- el entregado por Jefatura y recién entonces libera el acceso. Audita el cambio.
-- ---------------------------------------------------------------------
create function public.sgc_clave_cambiada() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_user text; v_id uuid;
begin
  select raw_app_meta_data->>'sgc_usuario' into v_user from auth.users where id = v_uid;
  select id_usuario into v_id from public.usuario where username = v_user and activo;
  if v_id is null then
    raise exception 'Sesión no válida o usuario desactivado.' using errcode = '42501';
  end if;
  if exists (select 1 from sgc_interno.clave_temporal c join auth.users a on a.id = c.id_auth
             where c.id_auth = v_uid and a.encrypted_password = c.hash) then
    raise exception 'Todavía usa la contraseña temporal. Defina una contraseña nueva.' using errcode = 'P0001';
  end if;
  delete from sgc_interno.clave_temporal where id_auth = v_uid;
  update auth.users set raw_app_meta_data = raw_app_meta_data || '{"debe_cambiar_clave": false}'::jsonb
   where id = v_uid;
  perform sgc_interno.guardar_auditoria(v_id, 'CAMBIO_CLAVE', v_user || ' cambió su contraseña',
                                        sgc_interno.ip_cliente(), now());
end $$;

-- ---------------------------------------------------------------------
-- sgc_indicadores(desde, hasta): un hecho ANÓNIMO por turno para el tablero
-- gerencial: sin código de turno, nombres, DNI, historia ni receta, y con la
-- llegada redondeada a la hora (no se puede cruzar con la hora exacta de la
-- auditoría). Trae la duración de cada etapa, estado, prioridad, consultorio,
-- médico, sexo, edad, SIS, códigos CIE-10, destino, motivo de cancelación y
-- especialidad de la cita (y si fue para otro día).
-- La agregación la hace la app (src/lib/analytics.js). Solo Jefatura.
-- ---------------------------------------------------------------------
create function sgc_interno.minutos(p_desde timestamptz, p_hasta timestamptz) returns float8
language sql immutable set search_path = '' as $$
  -- Si el médico llama antes de la hora de la cita, la espera es 0 (igual que minutesBetween en la app)
  select case when p_desde is null or p_hasta is null then null
              else greatest(0, extract(epoch from p_hasta - p_desde)::float8 / 60) end $$;

create function public.sgc_indicadores(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if sgc_interno.rol_actual() is distinct from 'JEFATURA' then
    raise exception 'Solo Jefatura puede consultar los indicadores de gestión.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 92 then
    raise exception 'Rango de fechas no válido (máximo 93 días).' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      't0', sgc_interno.ms(date_trunc('hour', t.hora_llegada)),
      'dur', jsonb_build_object(
        'espPago', sgc_interno.minutos(t.hora_llegada, pg.fecha_pago),
        'espTri', sgc_interno.minutos(pg.fecha_pago, t.ts_inicio_triaje),
        'tri', sgc_interno.minutos(t.ts_inicio_triaje, t.ts_fin_triaje),
        'espCita', sgc_interno.minutos(t.ts_fin_triaje, ci.fecha_registro),
        'espMed', sgc_interno.minutos(case when ci.ts_llegada is not null
                    then greatest(ci.ts_llegada, (ci.fecha_cita + ci.hora_cita) at time zone 'America/Lima') end,
                    t.ts_llamado_consulta),
        'med', case when t.estado = 'ATENDIDO' then sgc_interno.minutos(t.ts_llamado_consulta, t.ts_cierre) end),
      'motivo', case when t.estado = 'CANCELADO' then t.motivo_cancelacion end,
      'state', sgc_interno.estado_app(t.estado, t.ts_fin_triaje),
      'prio', case when t.ts_fin_triaje is null then null else t.nivel_prioridad end,
      'area', coalesce(aa.nombre, case when ar.tipo = 'CONSULTORIO' then ar.nombre end),
      'med', coalesce(um.username, case when t.estado = 'EN_CONSULTA' then uat.username end),
      'sexo', p.sexo,
      'edad', extract(year from age((t.hora_llegada at time zone 'America/Lima')::date, p.fecha_nacimiento))::int,
      'sis', p.condicion_sis,
      'dx', coalesce((select jsonb_agg(d.codigo_cie10 order by d.tipo_diagnostico, d.codigo_cie10)
                      from public.atencion_diagnostico d where d.id_atencion = am.id_atencion), '[]'::jsonb),
      'dest', case am.destino_alta when 'ALTA' then 'Alta' when 'REPOSO' then 'Reposo médico'
                                   when 'DERIVACION_HOSPITAL' then 'Derivación a hospital' end,
      'esp', es.codigo,
      'otroDia', case when ci.id_cita is not null then ci.fecha_cita <> t.fecha_turno end)
      order by t.hora_llegada)
    from public.turno t
    join public.paciente p on p.id_paciente = t.id_paciente
    left join public.area_atencion ar on ar.id_area = t.id_area_destino
    left join public.usuario uat on uat.id_usuario = t.id_usuario_en_atencion
    left join public.atencion_medica am on am.id_turno = t.id_turno
    left join public.area_atencion aa on aa.id_area = am.id_area
    left join public.usuario um on um.id_usuario = am.id_usuario_medico
    left join public.pago pg on pg.id_turno = t.id_turno
    left join public.cita ci on ci.id_turno = t.id_turno
    left join public.especialidad es on es.id_especialidad = ci.id_especialidad
    where t.fecha_turno between p_desde and p_hasta), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- sgc_sala(): datos públicos de la pantalla de sala. Sin nombres ni DNI.
-- ---------------------------------------------------------------------
-- RF-14: espera aproximada (min) de cada turno en cola. Misma regla que src/lib/espera.js:
--   resto de la atención en curso + turnos por delante × promedio móvil de las últimas 20 atenciones
--   del día (triaje: un módulo; consulta: la cola de cada médico). Con menos de 3 atenciones se usa
--   la referencia (7 min de triaje; la duración del cupo en consulta). Nadie pasa antes de su cita.
create function sgc_interno.esperas() returns table (id_turno uuid, espera integer)
language sql stable set search_path = '' as $$
  with desde as (select ((now() at time zone 'America/Lima')::date)::timestamp at time zone 'America/Lima' as t),
  tri_d as (
    select extract(epoch from t.ts_fin_triaje - t.ts_inicio_triaje) / 60 as d,
           row_number() over (order by t.ts_fin_triaje desc) as n
      from public.turno t, desde
     where t.ts_inicio_triaje is not null and t.ts_fin_triaje >= desde.t and t.ts_fin_triaje <= now()),
  tri_m as (select case when count(*) >= 3 then avg(d) filter (where n <= 20) else 7 end as m from tri_d),
  tri_ocupado as (
    select coalesce(sum(greatest(1, m.m - extract(epoch from now() - t.ts_inicio_triaje) / 60)), 0) as r
      from public.turno t, tri_m m
     where t.estado = 'EN_TRIAJE' or (t.estado = 'LLAMANDO' and t.ts_fin_triaje is null)),
  tri as (
    select t.id_turno, (row_number() over (order by t.hora_llegada) - 1) * m.m + o.r as e
      from public.turno t, tri_m m, tri_ocupado o
     where t.estado = 'EN_ESPERA_TRIAJE'),
  cola as (
    select t.id_turno, c.id_usuario_medico as med, e.duracion_cita_min as ref,
           (c.fecha_cita + c.hora_cita) at time zone 'America/Lima' as hora,
           row_number() over (partition by c.id_usuario_medico
                              order by array_position(array['CRITICA','PRIORITARIA','NORMAL']::text[], t.nivel_prioridad::text),
                                       greatest(c.ts_llegada, (c.fecha_cita + c.hora_cita) at time zone 'America/Lima'),
                                       t.hora_llegada) - 1 as i
      from public.turno t
      join public.cita c on c.id_turno = t.id_turno
      join public.especialidad e on e.id_especialidad = c.id_especialidad
     where t.estado = 'EN_ESPERA_CONSULTA'),
  med_d as (
    select am.id_usuario_medico as med, extract(epoch from t.ts_cierre - t.ts_llamado_consulta) / 60 as d,
           row_number() over (partition by am.id_usuario_medico order by t.ts_cierre desc) as n
      from public.turno t join public.atencion_medica am on am.id_turno = t.id_turno, desde
     where t.estado = 'ATENDIDO' and t.ts_llamado_consulta is not null
       and t.ts_cierre >= desde.t and t.ts_cierre <= now()),
  med_m as (
    select q.med, case when (select count(*) from med_d d where d.med = q.med) >= 3
                       then (select avg(d.d) from med_d d where d.med = q.med and d.n <= 20)
                       else q.ref end as m
      from (select distinct med, ref from cola) q),
  med_ocupado as (
    select m.med, coalesce((
             select sum(greatest(1, m.m - extract(epoch from now() - t.ts_llamado_consulta) / 60))
               from public.turno t join public.cita c on c.id_turno = t.id_turno
              where c.id_usuario_medico = m.med
                and (t.estado = 'EN_CONSULTA' or (t.estado = 'LLAMANDO' and t.ts_fin_triaje is not null))), 0) as r
      from med_m m),
  med as (
    select q.id_turno, greatest(o.r + q.i * m.m, extract(epoch from q.hora - now()) / 60) as e
      from cola q join med_m m on m.med = q.med join med_ocupado o on o.med = q.med)
  select id_turno, round(e::numeric)::integer from tri
  union all
  select id_turno, round(e::numeric)::integer from med $$;

create function public.sgc_sala() returns jsonb
language sql stable security definer set search_path = '' as $$
  -- Ya ordenado como se muestra: llamados (el último primero), consulta por prioridad y hora de la cita,
  -- triaje y caja por llegada. No expone la prioridad ni la hora de llegada; sí la espera aproximada (RF-14)
  -- y, para quien espera consulta, el consultorio de su cita (cada estación tiene su zona en la pantalla).
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', t.codigo_turno,
           'state', sgc_interno.estado_app(t.estado, t.ts_fin_triaje),
           'calledAt', sgc_interno.ms(t.ts_ultimo_llamado),
           'dest', a.nombre,
           'zona', case when t.estado = 'EN_ESPERA_CONSULTA' then ca.nombre end,
           'espera', es.espera))
         order by case t.estado when 'LLAMANDO' then 0 when 'EN_ESPERA_CONSULTA' then 1 else 2 end,
                  t.ts_ultimo_llamado desc nulls last,
                  case when t.estado = 'EN_ESPERA_CONSULTA'
                       then array_position(array['CRITICA','PRIORITARIA','NORMAL']::text[], t.nivel_prioridad::text) end,
                  -- en consulta, por la hora de la cita (o de llegada, si llegó tarde)
                  case when t.estado = 'EN_ESPERA_CONSULTA'
                       then greatest(c.ts_llegada, (c.fecha_cita + c.hora_cita) at time zone 'America/Lima') end,
                  t.hora_llegada), '[]'::jsonb)
  from public.turno t left join public.area_atencion a on a.id_area = t.id_area_destino
  left join public.cita c on c.id_turno = t.id_turno
  left join public.area_atencion ca on ca.id_area = c.id_area
  left join sgc_interno.esperas() es on es.id_turno = t.id_turno
  where t.estado in ('PENDIENTE_PAGO','EN_ESPERA_TRIAJE','LLAMANDO','EN_ESPERA_CONSULTA')
    -- turnos de hoy o de ayer, y los citados para hoy aunque hayan sacado la cita días antes
    and (t.fecha_turno >= (now() at time zone 'America/Lima')::date - 1
         or c.fecha_cita = (now() at time zone 'America/Lima')::date) $$;

-- =====================================================================
-- Cita por web o por teléfono. El paciente (o Admisión, por teléfono) reserva
-- con el DNI y la fecha de nacimiento. Solo pacientes con historia clínica y
-- una sola cita o turno activo a la vez. El día de la cita registra su llegada
-- en Admisión, paga en Caja si no tiene SIS, pasa por triaje y lo atiende su médico.
-- =====================================================================

-- Intentos fallidos por DNI: tras 5 en 15 minutos se bloquea (evita adivinar la fecha de nacimiento)
create table sgc_interno.intento_cita (
    dni    varchar(15) not null,
    fecha  timestamptz not null default now()
);
create index ix_intento_cita on sgc_interno.intento_cita (dni, fecha);

-- Paciente con historia que coincide con DNI y fecha de nacimiento (null si no coincide)
create function sgc_interno.verificar_paciente(p_dni text, p_nac date) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_pac uuid;
begin
  if (select count(*) from sgc_interno.intento_cita
       where dni = p_dni and fecha > now() - interval '15 minutes') >= 5 then
    raise exception 'Demasiados intentos con ese DNI. Espere 15 minutos e inténtelo de nuevo.' using errcode = 'P0001';
  end if;
  select p.id_paciente into v_pac
    from public.paciente p join public.historia_clinica h on h.id_paciente = p.id_paciente
   where p.tipo_documento = 'DNI' and p.numero_documento = p_dni and p.fecha_nacimiento = p_nac;
  if v_pac is null then
    insert into sgc_interno.intento_cita (dni) values (left(coalesce(p_dni, ''), 15));
  end if;
  return v_pac;
end $$;

-- Cita o turno activo del paciente (sin datos clínicos)
create function sgc_interno.cita_activa(p_pac uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'id', t.codigo_turno, 'state', sgc_interno.estado_app(t.estado, t.ts_fin_triaje),
           'cita', case when c.id_cita is not null then jsonb_build_object(
             'esp', e.codigo, 'med', u.username, 'medico', u.nombre_completo, 'area', a.nombre,
             'at', sgc_interno.ms((c.fecha_cita + c.hora_cita) at time zone 'America/Lima')) end)
    from public.turno t
    left join public.cita c on c.id_turno = t.id_turno
    left join public.especialidad e on e.id_especialidad = c.id_especialidad
    left join public.usuario u on u.id_usuario = c.id_usuario_medico
    left join public.area_atencion a on a.id_area = c.id_area
   where t.id_paciente = p_pac and t.estado not in ('ATENDIDO','CANCELADO')
   order by t.hora_llegada desc limit 1 $$;

-- Llegada de quien reservó: la cita debe ser hoy y todavía sin triaje; con o sin SIS según corresponda
create function sgc_interno.llegada_reserva(p_turno uuid, p_exonerado boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select fecha_cita from public.cita where id_turno = p_turno) is distinct from sgc_interno.hoy() then
    raise exception 'La llegada se registra el día de la cita.' using errcode = 'P0001';
  end if;
  if (select ts_fin_triaje from public.turno where id_turno = p_turno) is not null then
    raise exception 'Este paciente ya pasó por triaje: pasa directo a la espera de su médico.' using errcode = 'P0001';
  end if;
  if sgc_interno.exonerado((select p.condicion_sis from public.turno t join public.paciente p using (id_paciente)
                             where t.id_turno = p_turno)) is distinct from p_exonerado then
    raise exception '%', case when p_exonerado then 'Sin SIS, el paciente primero paga en Caja.'
                              else 'Con SIS no se cobra: el paciente pasa directo a triaje.' end using errcode = 'P0001';
  end if;
end $$;

-- Identifica al paciente y devuelve su nombre de pila y su cita o turno activo
create function public.sgc_paciente_cita(p_dni text, p_nac date) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pac uuid;
begin
  v_pac := sgc_interno.verificar_paciente(p_dni, p_nac);
  if v_pac is null then
    return jsonb_build_object('error', 'No encontramos un paciente con ese DNI y esa fecha de nacimiento. '
                                       'Si es su primera atención, acérquese a Admisión para abrir su historia clínica.');
  end if;
  return jsonb_build_object('nom', (select split_part(nombres, ' ', 1) from public.paciente where id_paciente = v_pac),
                            'activa', sgc_interno.cita_activa(v_pac));
end $$;

-- Médicos, horario y cupos ya tomados de una especialidad (solo médico y hora: sin datos de pacientes)
create function public.sgc_cupos(p_esp text) returns jsonb
language sql stable security definer set search_path = '' as $$
select jsonb_build_object(
  'users', coalesce((
    select jsonb_agg(jsonb_build_object('u', u.username, 'n', u.nombre_completo, 'role', 'med', 'on', true, 'esp', e.codigo))
      from public.usuario u join public.especialidad e on e.id_especialidad = u.id_especialidad
     where u.rol = 'MEDICO' and u.activo and e.codigo = p_esp), '[]'::jsonb),
  'horarios', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id_horario, 'med', u.username, 'dow', h.dia_semana,
             'ini', to_char(h.hora_inicio, 'HH24:MI'), 'fin', to_char(h.hora_fin, 'HH24:MI'),
             'area', a.nombre, 'on', h.activo))
      from public.horario_medico h
      join public.usuario u on u.id_usuario = h.id_usuario_medico
      join public.especialidad e on e.id_especialidad = u.id_especialidad
      join public.area_atencion a on a.id_area = h.id_area
     where h.activo and u.activo and e.codigo = p_esp), '[]'::jsonb),
  'ocupadas', coalesce((
    select jsonb_agg(jsonb_build_object('med', u.username,
             'at', sgc_interno.ms((c.fecha_cita + c.hora_cita) at time zone 'America/Lima')))
      from public.cita c
      join public.usuario u on u.id_usuario = c.id_usuario_medico
      join public.especialidad e on e.id_especialidad = c.id_especialidad
     where e.codigo = p_esp and not c.es_sobrecupo and c.estado not in ('CANCELADA','NO_ASISTIO')
       and c.fecha_cita >= sgc_interno.hoy()), '[]'::jsonb)) $$;

-- Reserva la cita. Por teléfono la registra Admisión con su sesión; por la web, el usuario a.citasweb.
create function public.sgc_reservar_cita(p_dni text, p_nac date, p_cita jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_pac uuid; yo record; v_autor uuid; v_canal text; v_turno uuid; v_codigo text; v_act jsonb;
begin
  v_pac := sgc_interno.verificar_paciente(p_dni, p_nac);
  if v_pac is null then
    return jsonb_build_object('error', 'No encontramos un paciente con ese DNI y esa fecha de nacimiento.');
  end if;
  -- Una sola cita o turno activo: se bloquea al paciente para que dos pedidos a la vez no pasen los dos
  perform 1 from public.paciente where id_paciente = v_pac for update;
  v_act := sgc_interno.cita_activa(v_pac);
  if v_act is not null then
    raise exception 'Ya tiene % (%). Solo puede tener una a la vez: espere a ser atendido o pida en Admisión que la anulen.',
      case when v_act->'cita' is not null then 'una cita pendiente' else 'un turno activo' end, v_act->>'id'
      using errcode = 'P0001';
  end if;

  select * into yo from sgc_interno.usuario_actual();
  -- Por teléfono la registra Admisión; el próximo control, el médico al cerrar la atención
  if yo.id_usuario is not null and yo.rol in ('ADMISION','MEDICO') then
    v_autor := yo.id_usuario; v_canal := case yo.rol when 'MEDICO' then 'control médico' else 'teléfono' end;
  else
    select id_usuario into v_autor from public.usuario where username = 'a.citasweb';
    v_canal := 'web';
  end if;

  -- Código del turno: el siguiente entre los de hoy y los que siguen abiertos (igual que la app)
  select 'TR-' || lpad((coalesce(max((regexp_match(codigo_turno, '^TR-(\d+)$'))[1]::int), 0) + 1)::text, 3, '0')
    into v_codigo
    from public.turno
   where fecha_turno = sgc_interno.hoy() or estado not in ('ATENDIDO','CANCELADO');

  insert into public.turno (fecha_turno, codigo_turno, id_paciente, id_usuario_admision, hora_llegada, estado)
  values (sgc_interno.hoy(), v_codigo, v_pac, v_autor, now(), 'CITADO')
  returning id_turno into v_turno;
  -- Sin triaje no hay prioridad: la cita es un cupo normal del horario (nunca sobrecupo)
  perform sgc_interno.guardar_cita(v_turno, p_cita - 'sobre', v_autor, 'NORMAL', true);
  perform sgc_interno.guardar_auditoria(v_autor, 'CITA_WEB', format('%s reservó su cita por %s', v_codigo, v_canal),
                                        sgc_interno.ip_cliente(), now());
  return sgc_interno.cita_activa(v_pac);
end $$;

-- =====================================================================
-- Permisos y políticas de seguridad (RLS)
-- =====================================================================
revoke all on all tables in schema public from anon, authenticated;
revoke all on schema sgc_interno from public, anon, authenticated;
revoke execute on all functions in schema sgc_interno from public, anon, authenticated;
revoke execute on function public.sgc_cargar(), public.sgc_guardar(jsonb), public.sgc_restablecer_demo(jsonb),
                           public.sgc_restablecer_demo_lote(uuid, jsonb), public.sgc_historia(text),
                           public.sgc_indicadores(date, date), public.sgc_clave_cambiada(), public.sgc_sala()
  from public, anon, authenticated;
revoke all on sgc_interno.carga_demo, sgc_interno.clave_temporal, sgc_interno.intento_cita from public, anon, authenticated;
revoke execute on function public.sgc_paciente_cita(text, date), public.sgc_cupos(text),
                           public.sgc_reservar_cita(text, date, jsonb) from public;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;

-- Lectura: solo usuarios con sesión; las filas visibles las decide RLS.
grant select on public.paciente, public.area_atencion, public.turno,
                public.signos_vitales, public.atencion_medica, public.diagnostico_cie10,
                public.atencion_diagnostico, public.receta_medica, public.detalle_receta,
                public.umbral_clinico, public.auditoria,
                public.especialidad, public.horario_medico, public.pago, public.cita to authenticated;
-- HISTORIA_CLINICA sin antecedentes (se leen con sgc_interno.antecedentes, solo Enfermería y Medicina)
grant select (id_historia, id_paciente, numero_historia, alergias_medicamentosas, fecha_apertura)
  on public.historia_clinica to authenticated;
-- USUARIO sin la columna password_hash
grant select (id_usuario, username, rol, nombre_completo, colegiatura, id_especialidad, activo, creado_en)
  on public.usuario to authenticated;

-- Funciones que usa sgc_cargar() (se ejecuta con los permisos de quien llama)
grant usage on schema sgc_interno to authenticated;
grant execute on function sgc_interno.ms(timestamptz), sgc_interno.estado_app(text, timestamptz),
                          sgc_interno.mapa_umbral(), sgc_interno.usuario_actual(), sgc_interno.rol_actual(),
                          sgc_interno.antecedentes(uuid), sgc_interno.motivo_triaje(uuid), sgc_interno.turnos_json(date, text),
                          sgc_interno.auditar_historia(text)
  to authenticated;

grant execute on function public.sgc_cargar(), public.sgc_guardar(jsonb), public.sgc_restablecer_demo(jsonb),
                          public.sgc_restablecer_demo_lote(uuid, jsonb), public.sgc_historia(text),
                          public.sgc_indicadores(date, date), public.sgc_clave_cambiada()
  to authenticated;
grant execute on function public.sgc_sala() to anon, authenticated;
-- Cita por web o por teléfono: el paciente se identifica con su DNI y su fecha de nacimiento
grant execute on function public.sgc_paciente_cita(text, date), public.sgc_cupos(text),
                          public.sgc_reservar_cita(text, date, jsonb) to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['paciente','usuario','area_atencion','historia_clinica','turno','signos_vitales',
                           'atencion_medica','diagnostico_cie10','atencion_diagnostico','receta_medica',
                           'detalle_receta','umbral_clinico','auditoria',
                           'especialidad','horario_medico','pago','cita'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Cualquier usuario activo del sistema
create policy personal_activo on public.usuario for select to authenticated
  using ((select sgc_interno.rol_actual()) is not null);
create policy personal_activo on public.area_atencion for select to authenticated
  using ((select sgc_interno.rol_actual()) is not null);
create policy personal_activo on public.diagnostico_cie10 for select to authenticated
  using ((select sgc_interno.rol_actual()) is not null);
create policy personal_activo on public.turno for select to authenticated
  using ((select sgc_interno.rol_actual()) is not null);
create policy personal_activo on public.umbral_clinico for select to authenticated
  using ((select sgc_interno.rol_actual()) is not null);
-- Especialidades, horarios, pagos y citas: todo el personal (la agenda y la ruta se ven en cada estación;
-- no contienen datos clínicos)
create policy personal_activo on public.especialidad for select to authenticated
  using ((select sgc_interno.rol_actual()) is not null);
create policy personal_activo on public.horario_medico for select to authenticated
  using ((select sgc_interno.rol_actual()) is not null);
create policy personal_activo on public.pago for select to authenticated
  using ((select sgc_interno.rol_actual()) is not null);
create policy personal_activo on public.cita for select to authenticated
  using ((select sgc_interno.rol_actual()) is not null);

-- Datos personales del paciente: personal asistencial y Caja, que cobra y emite la boleta a su nombre (no Jefatura)
create policy personal_asistencial on public.paciente for select to authenticated
  using ((select sgc_interno.rol_actual()) in ('ADMISION','CAJA','ENFERMERIA','MEDICO'));
create policy personal_asistencial on public.historia_clinica for select to authenticated
  using ((select sgc_interno.rol_actual()) in ('ADMISION','CAJA','ENFERMERIA','MEDICO'));

-- Signos vitales: Enfermería y Medicina
create policy personal_clinico on public.signos_vitales for select to authenticated
  using ((select sgc_interno.rol_actual()) in ('ENFERMERIA','MEDICO'));

-- Atención, diagnósticos y recetas: solo Medicina
create policy solo_medico on public.atencion_medica for select to authenticated
  using ((select sgc_interno.rol_actual()) = 'MEDICO');
create policy solo_medico on public.atencion_diagnostico for select to authenticated
  using ((select sgc_interno.rol_actual()) = 'MEDICO');
create policy solo_medico on public.receta_medica for select to authenticated
  using ((select sgc_interno.rol_actual()) = 'MEDICO');
create policy solo_medico on public.detalle_receta for select to authenticated
  using ((select sgc_interno.rol_actual()) = 'MEDICO');

-- Auditoría: solo Jefatura
create policy solo_jefatura on public.auditoria for select to authenticated
  using ((select sgc_interno.rol_actual()) = 'JEFATURA');

-- Tiempo real: cada estación recibe solo los cambios que su rol puede leer.
do $$
declare t text;
begin
  foreach t in array array['usuario','paciente','historia_clinica','turno','umbral_clinico','auditoria',
                           'horario_medico','pago','cita'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
