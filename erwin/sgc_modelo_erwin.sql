/* =====================================================================
   SGC · Sistema de Gestión Clínica · Modelo de datos para CA ERwin r7
   17 tablas: las 13 del informe + ESPECIALIDAD, HORARIO_MEDICO, PAGO y CITA.

   Es el mismo modelo que supabase/schema.sql (la base real, PostgreSQL en la
   nube), escrito en SQL Server 2005 para que ERwin r7 lo lea por ingeniería
   inversa. Solo sirve para el diagrama: no se ejecuta en Supabase.

   Cómo generar el diagrama en ERwin r7:
     1. Tools > Reverse Engineer...
     2. New Model Type: Logical/Physical.
        Target Database: SQL Server · Version: 2005 (o 2000/2005).
     3. Reverse Engineer From: Script File > elija este archivo > Next.
     4. Deje marcadas las opciones de tablas, claves primarias, claves
        foráneas e índices > Next (o Finish).
     5. Format > Display Level: Attribute (o Primary Key) y
        Layout > Auto Layout (o Arrange) para ordenar las entidades.

   Equivalencia de tipos con PostgreSQL (Supabase):
     uuid -> uniqueidentifier · timestamptz y date -> datetime
     time -> datetime (solo la hora) · boolean -> bit
     text y jsonb -> varchar(max) · inet -> varchar(45)

   Reglas que SQL Server 2005 no expresa en el DDL (en Supabase son índices
   parciales o validaciones en funciones):
     · Un paciente no tiene dos turnos activos el mismo día.
     · Un cupo de cita (médico, fecha y hora) no se da dos veces, salvo
       sobrecupo o cita cancelada/no asistida.
     · Los bloques de horario de un médico o de un consultorio no se cruzan.
   ===================================================================== */


/* ---------------------------------------------------------------------
   TABLAS
   --------------------------------------------------------------------- */

CREATE TABLE paciente (
    id_paciente           uniqueidentifier NOT NULL DEFAULT NEWID(),
    tipo_documento        varchar(10)      NOT NULL DEFAULT 'DNI',
    numero_documento      varchar(15)      NOT NULL,
    nombres               varchar(100)     NOT NULL,
    apellidos             varchar(100)     NOT NULL,
    fecha_nacimiento      datetime         NOT NULL,
    sexo                  char(1)          NOT NULL,
    telefono              varchar(15)      NULL,
    condicion_sis         varchar(25)      NOT NULL DEFAULT 'PENDIENTE_VALIDACION',
    fecha_validacion_sis  datetime         NULL,
    creado_en             datetime         NOT NULL DEFAULT GETDATE(),
    CONSTRAINT pk_paciente PRIMARY KEY (id_paciente),
    CONSTRAINT uq_paciente_documento UNIQUE (tipo_documento, numero_documento),
    CONSTRAINT ck_paciente_tipo_doc CHECK (tipo_documento IN ('DNI','CE','PASAPORTE','OTRO')),
    CONSTRAINT ck_paciente_sexo CHECK (sexo IN ('M','F')),
    CONSTRAINT ck_paciente_sis CHECK (condicion_sis IN ('ACTIVO','NO_ASEGURADO','PENDIENTE_VALIDACION'))
)
go

CREATE TABLE especialidad (
    id_especialidad    uniqueidentifier NOT NULL DEFAULT NEWID(),
    codigo             varchar(5)       NOT NULL,
    nombre             varchar(60)      NOT NULL,
    duracion_cita_min  smallint         NOT NULL,
    activo             bit              NOT NULL DEFAULT 1,
    CONSTRAINT pk_especialidad PRIMARY KEY (id_especialidad),
    CONSTRAINT uq_especialidad_codigo UNIQUE (codigo),
    CONSTRAINT uq_especialidad_nombre UNIQUE (nombre),
    CONSTRAINT ck_especialidad_duracion CHECK (duracion_cita_min BETWEEN 10 AND 120)
)
go

CREATE TABLE usuario (
    id_usuario       uniqueidentifier NOT NULL DEFAULT NEWID(),
    username         varchar(50)      NOT NULL,
    password_hash    varchar(255)     NOT NULL,
    rol              varchar(15)      NOT NULL,
    nombre_completo  varchar(150)     NOT NULL,
    colegiatura      varchar(15)      NULL,
    id_especialidad  uniqueidentifier NULL,
    activo           bit              NOT NULL DEFAULT 1,
    creado_en        datetime         NOT NULL DEFAULT GETDATE(),
    CONSTRAINT pk_usuario PRIMARY KEY (id_usuario),
    CONSTRAINT uq_usuario_username UNIQUE (username),
    CONSTRAINT ck_usuario_rol CHECK (rol IN ('ADMISION','CAJA','ENFERMERIA','MEDICO','JEFATURA'))
)
go

CREATE TABLE area_atencion (
    id_area  uniqueidentifier NOT NULL DEFAULT NEWID(),
    nombre   varchar(60)      NOT NULL,
    tipo     varchar(12)      NOT NULL,
    activo   bit              NOT NULL DEFAULT 1,
    CONSTRAINT pk_area_atencion PRIMARY KEY (id_area),
    CONSTRAINT uq_area_nombre UNIQUE (nombre),
    CONSTRAINT ck_area_tipo CHECK (tipo IN ('TRIAJE','CONSULTORIO'))
)
go

CREATE TABLE horario_medico (
    id_horario         uniqueidentifier NOT NULL DEFAULT NEWID(),
    id_usuario_medico  uniqueidentifier NOT NULL,
    id_area            uniqueidentifier NOT NULL,
    dia_semana         smallint         NOT NULL,
    hora_inicio        datetime         NOT NULL,
    hora_fin           datetime         NOT NULL,
    activo             bit              NOT NULL DEFAULT 1,
    CONSTRAINT pk_horario_medico PRIMARY KEY (id_horario),
    CONSTRAINT ck_horario_dia CHECK (dia_semana BETWEEN 1 AND 7),
    CONSTRAINT ck_horario_horas CHECK (hora_fin > hora_inicio)
)
go

CREATE TABLE historia_clinica (
    id_historia               uniqueidentifier NOT NULL DEFAULT NEWID(),
    id_paciente               uniqueidentifier NOT NULL,
    numero_historia           varchar(20)      NOT NULL,
    antecedentes_patologicos  varchar(max)     NULL,
    alergias_medicamentosas   varchar(max)     NULL,
    fecha_apertura            datetime         NOT NULL DEFAULT GETDATE(),
    CONSTRAINT pk_historia_clinica PRIMARY KEY (id_historia),
    CONSTRAINT uq_historia_paciente UNIQUE (id_paciente),
    CONSTRAINT uq_historia_numero UNIQUE (numero_historia)
)
go

CREATE TABLE turno (
    id_turno                uniqueidentifier NOT NULL DEFAULT NEWID(),
    fecha_turno             datetime         NOT NULL,
    codigo_turno            varchar(10)      NOT NULL,
    id_paciente             uniqueidentifier NOT NULL,
    id_usuario_admision     uniqueidentifier NOT NULL,
    id_area_destino         uniqueidentifier NULL,
    estado                  varchar(20)      NOT NULL DEFAULT 'PENDIENTE_PAGO',
    nivel_prioridad         varchar(12)      NOT NULL DEFAULT 'NORMAL',
    hora_llegada            datetime         NOT NULL DEFAULT GETDATE(),
    ts_inicio_triaje        datetime         NULL,
    ts_fin_triaje           datetime         NULL,
    ts_llamado_consulta     datetime         NULL,
    ts_cierre               datetime         NULL,
    motivo_cancelacion      varchar(100)     NULL,
    ts_ultimo_llamado       datetime         NULL,
    veces_llamado           smallint         NOT NULL DEFAULT 0,
    id_usuario_en_atencion  uniqueidentifier NULL,
    CONSTRAINT pk_turno PRIMARY KEY (id_turno),
    CONSTRAINT uq_turno_codigo_dia UNIQUE (fecha_turno, codigo_turno),
    CONSTRAINT ck_turno_estado CHECK (estado IN ('PENDIENTE_PAGO','EN_ESPERA_TRIAJE','EN_TRIAJE','PENDIENTE_CITA',
                                                 'CITADO','EN_ESPERA_CONSULTA','LLAMANDO','EN_CONSULTA',
                                                 'ATENDIDO','CANCELADO')),
    CONSTRAINT ck_turno_prioridad CHECK (nivel_prioridad IN ('NORMAL','PRIORITARIA','CRITICA')),
    CONSTRAINT ck_turno_llamados CHECK (veces_llamado >= 0)
)
go

CREATE TABLE pago (
    id_pago             uniqueidentifier NOT NULL DEFAULT NEWID(),
    id_turno            uniqueidentifier NOT NULL,
    id_usuario_cajero   uniqueidentifier NOT NULL,
    concepto            varchar(60)      NOT NULL DEFAULT 'Consulta externa',
    monto               decimal(8,2)     NOT NULL,
    metodo_pago         varchar(10)      NOT NULL,
    numero_comprobante  varchar(15)      NULL,
    fecha_pago          datetime         NOT NULL DEFAULT GETDATE(),
    CONSTRAINT pk_pago PRIMARY KEY (id_pago),
    CONSTRAINT uq_pago_turno UNIQUE (id_turno),
    CONSTRAINT ck_pago_metodo CHECK (metodo_pago IN ('EFECTIVO','TARJETA','BILLETERA','SIS')),
    CONSTRAINT ck_pago_monto CHECK (monto >= 0)
)
go

CREATE TABLE cita (
    id_cita              uniqueidentifier NOT NULL DEFAULT NEWID(),
    id_turno             uniqueidentifier NOT NULL,
    id_especialidad      uniqueidentifier NOT NULL,
    id_usuario_medico    uniqueidentifier NOT NULL,
    id_area              uniqueidentifier NOT NULL,
    fecha_cita           datetime         NOT NULL,
    hora_cita            datetime         NOT NULL,
    es_sobrecupo         bit              NOT NULL DEFAULT 0,
    estado               varchar(12)      NOT NULL DEFAULT 'PROGRAMADA',
    id_usuario_registro  uniqueidentifier NOT NULL,
    fecha_registro       datetime         NOT NULL DEFAULT GETDATE(),
    ts_llegada           datetime         NULL,
    CONSTRAINT pk_cita PRIMARY KEY (id_cita),
    CONSTRAINT uq_cita_turno UNIQUE (id_turno),
    CONSTRAINT ck_cita_estado CHECK (estado IN ('PROGRAMADA','ATENDIDA','NO_ASISTIO','CANCELADA'))
)
go

CREATE TABLE signos_vitales (
    id_signos             uniqueidentifier NOT NULL DEFAULT NEWID(),
    id_turno              uniqueidentifier NOT NULL,
    id_usuario_enfermero  uniqueidentifier NOT NULL,
    presion_sistolica     smallint         NOT NULL,
    presion_diastolica    smallint         NOT NULL,
    pulso                 smallint         NOT NULL,
    frecuencia_resp       smallint         NOT NULL,
    temperatura           decimal(3,1)     NOT NULL,
    saturacion_spo2       decimal(4,1)     NOT NULL,
    peso_kg               decimal(5,2)     NOT NULL,
    talla_m               decimal(3,2)     NOT NULL,
    imc                   decimal(4,2)     NULL,
    motivo_triaje         varchar(255)     NOT NULL,
    alerta_critica        bit              NOT NULL DEFAULT 0,
    fecha_toma            datetime         NOT NULL DEFAULT GETDATE(),
    CONSTRAINT pk_signos_vitales PRIMARY KEY (id_signos),
    CONSTRAINT uq_signos_turno UNIQUE (id_turno),
    CONSTRAINT ck_sv_pas CHECK (presion_sistolica BETWEEN 50 AND 260),
    CONSTRAINT ck_sv_pad CHECK (presion_diastolica BETWEEN 30 AND 160),
    CONSTRAINT ck_sv_fc CHECK (pulso BETWEEN 20 AND 250),
    CONSTRAINT ck_sv_fr CHECK (frecuencia_resp BETWEEN 4 AND 80),
    CONSTRAINT ck_sv_temp CHECK (temperatura BETWEEN 30.0 AND 45.0),
    CONSTRAINT ck_sv_spo2 CHECK (saturacion_spo2 BETWEEN 50.0 AND 100.0)
)
go

CREATE TABLE atencion_medica (
    id_atencion        uniqueidentifier NOT NULL DEFAULT NEWID(),
    id_turno           uniqueidentifier NOT NULL,
    id_historia        uniqueidentifier NOT NULL,
    id_usuario_medico  uniqueidentifier NOT NULL,
    id_area            uniqueidentifier NOT NULL,
    motivo_consulta    varchar(max)     NOT NULL,
    examen_clinico     varchar(max)     NOT NULL,
    destino_alta       varchar(20)      NOT NULL,
    detalle_destino    varchar(150)     NULL,
    fecha_atencion     datetime         NOT NULL DEFAULT GETDATE(),
    CONSTRAINT pk_atencion_medica PRIMARY KEY (id_atencion),
    CONSTRAINT uq_atencion_turno UNIQUE (id_turno),
    CONSTRAINT ck_atencion_destino CHECK (destino_alta IN ('ALTA','REPOSO','DERIVACION_HOSPITAL'))
)
go

CREATE TABLE diagnostico_cie10 (
    codigo_cie10  varchar(10)  NOT NULL,
    descripcion   varchar(255) NOT NULL,
    CONSTRAINT pk_diagnostico_cie10 PRIMARY KEY (codigo_cie10)
)
go

CREATE TABLE atencion_diagnostico (
    id_atencion_diag  uniqueidentifier NOT NULL DEFAULT NEWID(),
    id_atencion       uniqueidentifier NOT NULL,
    codigo_cie10      varchar(10)      NOT NULL,
    tipo_diagnostico  varchar(12)      NOT NULL DEFAULT 'PRESUNTIVO',
    CONSTRAINT pk_atencion_diagnostico PRIMARY KEY (id_atencion_diag),
    CONSTRAINT uq_atencion_diag UNIQUE (id_atencion, codigo_cie10),
    CONSTRAINT ck_atdiag_tipo CHECK (tipo_diagnostico IN ('PRESUNTIVO','DEFINITIVO'))
)
go

CREATE TABLE receta_medica (
    id_receta      uniqueidentifier NOT NULL DEFAULT NEWID(),
    id_atencion    uniqueidentifier NOT NULL,
    codigo_receta  varchar(25)      NOT NULL,
    fecha_emision  datetime         NOT NULL DEFAULT GETDATE(),
    observaciones  varchar(max)     NULL,
    CONSTRAINT pk_receta_medica PRIMARY KEY (id_receta),
    CONSTRAINT uq_receta_atencion UNIQUE (id_atencion),
    CONSTRAINT uq_receta_codigo UNIQUE (codigo_receta)
)
go

CREATE TABLE detalle_receta (
    id_detalle           uniqueidentifier NOT NULL DEFAULT NEWID(),
    id_receta            uniqueidentifier NOT NULL,
    medicamento          varchar(120)     NOT NULL,
    concentracion        varchar(50)      NOT NULL,
    dosis                varchar(60)      NOT NULL,
    frecuencia           varchar(60)      NOT NULL,
    duracion_dias        smallint         NOT NULL,
    cantidad_solicitada  smallint         NULL,
    CONSTRAINT pk_detalle_receta PRIMARY KEY (id_detalle),
    CONSTRAINT ck_detalle_duracion CHECK (duracion_dias > 0)
)
go

CREATE TABLE umbral_clinico (
    id_umbral             uniqueidentifier NOT NULL DEFAULT NEWID(),
    parametro             varchar(20)      NOT NULL,
    nivel                 varchar(8)       NOT NULL DEFAULT 'CRITICO',
    operador              varchar(2)       NOT NULL,
    valor_umbral          decimal(6,2)     NOT NULL,
    id_usuario_aprobador  uniqueidentifier NOT NULL,
    vigente_desde         datetime         NOT NULL DEFAULT GETDATE(),
    vigente_hasta         datetime         NULL,
    CONSTRAINT pk_umbral_clinico PRIMARY KEY (id_umbral),
    CONSTRAINT ck_umbral_parametro CHECK (parametro IN ('SPO2','TEMPERATURA','PAS','PULSO_MAX','PULSO_MIN','FR_MAX','FR_MIN')),
    CONSTRAINT ck_umbral_nivel CHECK (nivel IN ('CRITICO','ALERTA')),
    CONSTRAINT ck_umbral_operador CHECK (operador IN ('<','<=','>','>='))
)
go

CREATE TABLE auditoria (
    id_auditoria        uniqueidentifier NOT NULL DEFAULT NEWID(),
    id_usuario          uniqueidentifier NOT NULL,
    tabla_afectada      varchar(60)      NOT NULL,
    id_registro         varchar(40)      NULL,
    operacion           varchar(10)      NOT NULL,
    valores_anteriores  varchar(max)     NULL,
    valores_nuevos      varchar(max)     NULL,
    direccion_ip        varchar(45)      NOT NULL,
    fecha_hora          datetime         NOT NULL DEFAULT GETDATE(),
    CONSTRAINT pk_auditoria PRIMARY KEY (id_auditoria),
    CONSTRAINT ck_auditoria_operacion CHECK (operacion IN ('INSERT','UPDATE','DELETE','SELECT','LOGIN','LOGOUT'))
)
go


/* ---------------------------------------------------------------------
   ÍNDICES (ERwin los muestra como entradas de inversión, IE)
   --------------------------------------------------------------------- */

CREATE INDEX ix_horario_medico_dia ON horario_medico (id_usuario_medico, dia_semana)
go
CREATE INDEX ix_turno_cola ON turno (estado, nivel_prioridad, hora_llegada)
go
CREATE INDEX ix_turno_paciente ON turno (id_paciente)
go
CREATE INDEX ix_pago_fecha ON pago (fecha_pago)
go
CREATE INDEX ix_cita_agenda ON cita (fecha_cita, id_usuario_medico)
go
CREATE INDEX ix_atencion_historia ON atencion_medica (id_historia, fecha_atencion)
go
CREATE INDEX ix_auditoria_usuario_fecha ON auditoria (id_usuario, fecha_hora)
go


/* ---------------------------------------------------------------------
   RELACIONES (claves foráneas)
   --------------------------------------------------------------------- */

-- USUARIO (médico) pertenece a una ESPECIALIDAD
ALTER TABLE usuario ADD CONSTRAINT fk_usuario_especialidad
    FOREIGN KEY (id_especialidad) REFERENCES especialidad (id_especialidad)
go

-- HORARIO_MEDICO: bloques semanales de un médico en un consultorio
ALTER TABLE horario_medico ADD CONSTRAINT fk_horario_medico
    FOREIGN KEY (id_usuario_medico) REFERENCES usuario (id_usuario)
go
ALTER TABLE horario_medico ADD CONSTRAINT fk_horario_area
    FOREIGN KEY (id_area) REFERENCES area_atencion (id_area)
go

-- HISTORIA_CLINICA 1:1 PACIENTE
ALTER TABLE historia_clinica ADD CONSTRAINT fk_historia_paciente
    FOREIGN KEY (id_paciente) REFERENCES paciente (id_paciente)
go

-- TURNO
ALTER TABLE turno ADD CONSTRAINT fk_turno_paciente
    FOREIGN KEY (id_paciente) REFERENCES paciente (id_paciente)
go
ALTER TABLE turno ADD CONSTRAINT fk_turno_usuario
    FOREIGN KEY (id_usuario_admision) REFERENCES usuario (id_usuario)
go
ALTER TABLE turno ADD CONSTRAINT fk_turno_area
    FOREIGN KEY (id_area_destino) REFERENCES area_atencion (id_area)
go
ALTER TABLE turno ADD CONSTRAINT fk_turno_en_atencion
    FOREIGN KEY (id_usuario_en_atencion) REFERENCES usuario (id_usuario)
go

-- PAGO 1:0..1 TURNO (antes del triaje)
ALTER TABLE pago ADD CONSTRAINT fk_pago_turno
    FOREIGN KEY (id_turno) REFERENCES turno (id_turno)
go
ALTER TABLE pago ADD CONSTRAINT fk_pago_cajero
    FOREIGN KEY (id_usuario_cajero) REFERENCES usuario (id_usuario)
go

-- CITA 1:0..1 TURNO (después del triaje), con un médico de una especialidad
ALTER TABLE cita ADD CONSTRAINT fk_cita_turno
    FOREIGN KEY (id_turno) REFERENCES turno (id_turno)
go
ALTER TABLE cita ADD CONSTRAINT fk_cita_especialidad
    FOREIGN KEY (id_especialidad) REFERENCES especialidad (id_especialidad)
go
ALTER TABLE cita ADD CONSTRAINT fk_cita_medico
    FOREIGN KEY (id_usuario_medico) REFERENCES usuario (id_usuario)
go
ALTER TABLE cita ADD CONSTRAINT fk_cita_area
    FOREIGN KEY (id_area) REFERENCES area_atencion (id_area)
go
ALTER TABLE cita ADD CONSTRAINT fk_cita_registro
    FOREIGN KEY (id_usuario_registro) REFERENCES usuario (id_usuario)
go

-- SIGNOS_VITALES 1:1 TURNO
ALTER TABLE signos_vitales ADD CONSTRAINT fk_signos_turno
    FOREIGN KEY (id_turno) REFERENCES turno (id_turno)
go
ALTER TABLE signos_vitales ADD CONSTRAINT fk_signos_enfermero
    FOREIGN KEY (id_usuario_enfermero) REFERENCES usuario (id_usuario)
go

-- ATENCION_MEDICA 1:1 TURNO
ALTER TABLE atencion_medica ADD CONSTRAINT fk_atencion_turno
    FOREIGN KEY (id_turno) REFERENCES turno (id_turno)
go
ALTER TABLE atencion_medica ADD CONSTRAINT fk_atencion_historia
    FOREIGN KEY (id_historia) REFERENCES historia_clinica (id_historia)
go
ALTER TABLE atencion_medica ADD CONSTRAINT fk_atencion_medico
    FOREIGN KEY (id_usuario_medico) REFERENCES usuario (id_usuario)
go
ALTER TABLE atencion_medica ADD CONSTRAINT fk_atencion_area
    FOREIGN KEY (id_area) REFERENCES area_atencion (id_area)
go

-- ATENCION_DIAGNOSTICO N:M entre ATENCION_MEDICA y DIAGNOSTICO_CIE10
ALTER TABLE atencion_diagnostico ADD CONSTRAINT fk_atdiag_atencion
    FOREIGN KEY (id_atencion) REFERENCES atencion_medica (id_atencion)
go
ALTER TABLE atencion_diagnostico ADD CONSTRAINT fk_atdiag_cie10
    FOREIGN KEY (codigo_cie10) REFERENCES diagnostico_cie10 (codigo_cie10)
go

-- RECETA_MEDICA 1:0..1 ATENCION_MEDICA y su DETALLE_RECETA
ALTER TABLE receta_medica ADD CONSTRAINT fk_receta_atencion
    FOREIGN KEY (id_atencion) REFERENCES atencion_medica (id_atencion)
go
ALTER TABLE detalle_receta ADD CONSTRAINT fk_detalle_receta
    FOREIGN KEY (id_receta) REFERENCES receta_medica (id_receta)
go

-- UMBRAL_CLINICO aprobado por un médico
ALTER TABLE umbral_clinico ADD CONSTRAINT fk_umbral_aprobador
    FOREIGN KEY (id_usuario_aprobador) REFERENCES usuario (id_usuario)
go

-- AUDITORIA: quién hizo cada operación
ALTER TABLE auditoria ADD CONSTRAINT fk_auditoria_usuario
    FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario)
go
