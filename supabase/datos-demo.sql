-- =====================================================================
-- Datos de demostración ampliados (para un proyecto con schema.sql y actualizacion-v1.2.sql)
--   1. Personal para todas las áreas: más ventanillas de Admisión, cajas, enfermería y Jefatura.
--   2. Más médicos (Medicina General, Pediatría, Cardiología y Ginecología) con su horario semanal,
--      en los turnos que los consultorios tenían libres.
--   3. Pacientes con distintos tipos de caso, con su historia clínica y atenciones anteriores completas
--      (pago, triaje, cita, consulta, diagnóstico y receta).
--   4. Atenciones en toda la cartera de primer nivel (Obstetricia, CRED, Odontología, Psicología, Nutrición,
--      Medicina Familiar e Interna): requieren haber ejecutado antes actualizacion-v1.3.sql; si no, se omiten.
-- Supabase → SQL Editor → pegar este archivo → Run.
-- Se puede volver a ejecutar: no duplica nada. Si Jefatura restablece los datos de demostración desde la app,
-- los pacientes se borran (el personal y los horarios se conservan): vuelva a ejecutar este archivo.
-- Contraseña de las cuentas nuevas: SgcDemo2026.
-- Todos los datos son ficticios.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 y 2. Personal y médicos
-- ---------------------------------------------------------------------
insert into public.usuario (username, password_hash, rol, nombre_completo, colegiatura, activo, id_especialidad)
select x.usr, 'pendiente', x.rol, x.nombre, x.col, true, e.id_especialidad
from (values
  ('a.admision4',  'ADMISION',   'Rosa Medina (demo)',            null,        null),
  ('a.admision5',  'ADMISION',   'Iván Coronado (demo)',          null,        null),
  ('c.caja4',      'CAJA',       'Paola Ugarte (demo)',           null,        null),
  ('e.triaje4',    'ENFERMERIA', 'Karina Soto (demo)',            'CEP-00004', null),
  ('e.triaje5',    'ENFERMERIA', 'Raúl Espinoza (demo)',          'CEP-00005', null),
  ('j.direccion',  'JEFATURA',   'Dr. Alberto Ruiz (demo)',       null,        null),
  ('m.general5',   'MEDICO',     'Dra. Mónica Lazo (demo)',       'CMP-00008', 'MG'),
  ('m.general6',   'MEDICO',     'Dr. César Aranda (demo)',       'CMP-00009', 'MG'),
  ('m.pediatria3', 'MEDICO',     'Dra. Natalia Ccama (demo)',     'CMP-00010', 'PED'),
  ('m.cardio2',    'MEDICO',     'Dra. Verónica Ibáñez (demo)',   'CMP-00011', 'CAR'),
  ('m.gineco2',    'MEDICO',     'Dr. Óscar Benavides (demo)',    'CMP-00012', 'GIN')
) as x(usr, rol, nombre, col, esp)
left join public.especialidad e on e.codigo = x.esp
on conflict (username) do nothing;

select sgc_interno.fijar_credencial(u.username, 'SgcDemo2026', false)
from public.usuario u
where u.username in ('a.admision4', 'a.admision5', 'c.caja4', 'e.triaje4', 'e.triaje5', 'j.direccion',
                     'm.general5', 'm.general6', 'm.pediatria3', 'm.cardio2', 'm.gineco2')
  and not exists (select 1 from auth.users a where lower(a.email) = lower(u.username || '@' || sgc_interno.dominio()));

-- Horarios (día 1 = lunes … 6 = sábado). Ocupan los turnos que estaban libres, sin cruzarse con nadie:
--   Consultorio 2: tardes (Cardiología lun-mié-vie, Medicina General mar-jue) y sábado por la mañana
--   Consultorio 3: tardes de martes y jueves, y sábado por la mañana (Pediatría)
--   Consultorio 4: mañanas de martes y jueves y tardes de lunes, miércoles y viernes (Ginecología)
-- guardar_horario valida que no haya cruces con otro médico o consultorio. Si un bloque choca con uno que
-- Jefatura creó desde la app, ese bloque se omite con un aviso y el resto continúa.
do $$
declare r record;
begin
  for r in
    select x.usr, x.area, x.ini, x.fin, d.dia
    from (values
      ('m.cardio2',    'Consultorio 2', '14:00', '19:00', array[1,3,5]),
      ('m.general5',   'Consultorio 2', '13:00', '19:00', array[2,4]),
      ('m.general6',   'Consultorio 2', '08:00', '13:00', array[6]),
      ('m.pediatria3', 'Consultorio 3', '13:00', '19:00', array[2,4]),
      ('m.pediatria3', 'Consultorio 3', '08:00', '13:00', array[6]),
      ('m.gineco2',    'Consultorio 4', '08:00', '13:00', array[2,4]),
      ('m.gineco2',    'Consultorio 4', '13:00', '19:00', array[1,3,5])
    ) as x(usr, area, ini, fin, dias)
    cross join lateral unnest(x.dias) as d(dia)
    join public.usuario u on u.username = x.usr
    where not exists (select 1 from public.horario_medico h
                       where h.id_usuario_medico = u.id_usuario and h.dia_semana = d.dia and h.activo
                         and h.hora_inicio = x.ini::time)
  loop
    begin
      perform sgc_interno.guardar_horario(jsonb_build_object('med', r.usr, 'dow', r.dia, 'ini', r.ini, 'fin', r.fin, 'area', r.area));
    exception when others then
      raise notice 'Horario omitido (% día %): %', r.usr, r.dia, sqlerrm;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Pacientes por tipo de caso (DNI 46000101 a 46000118)
--    Para probar un paciente NUEVO use un DNI que no exista, por ejemplo 46000201 a 46000299.
-- ---------------------------------------------------------------------
do $$
declare
  r record; v_pac uuid; v_hc int;
begin
  for r in select * from (values
    -- dni,       nombres,           apellidos,             nacimiento,   sexo, teléfono,      seguro,                 antecedentes,                                      alergias
    ('46000101', 'Valentina',        'Ríos Campos',         '2019-05-14', 'F', '987 100 101', 'ACTIVO',               'Asma bronquial leve',                            ''),
    ('46000102', 'Thiago',           'Mendoza Luna',        '2024-03-02', 'M', '987 100 102', 'ACTIVO',               'Recién nacido a término, vacunas completas',     ''),
    ('46000103', 'Camila',           'Huerta Soto',         '2010-08-21', 'F', '987 100 103', 'ACTIVO',               '',                                               ''),
    ('46000104', 'María Elena',      'Quispe Torres',       '1996-01-30', 'F', '987 100 104', 'ACTIVO',               'Gestante, segundo embarazo',                     ''),
    ('46000105', 'Jorge',            'Villanueva Prado',    '1950-11-09', 'M', '987 100 105', 'ACTIVO',               'Hipertensión arterial y diabetes mellitus tipo 2', 'AINE'),
    ('46000106', 'Teresa',           'Gamarra Rojas',       '1945-06-17', 'F', '987 100 106', 'ACTIVO',               'Insuficiencia cardiaca, fibrilación auricular', 'Penicilina'),
    ('46000107', 'Luis Fernando',    'Castro Díaz',         '1985-04-03', 'M', '987 100 107', 'NO_ASEGURADO',         '',                                               ''),
    ('46000108', 'Andrea',           'Paz Salinas',         '1992-12-11', 'F', '987 100 108', 'NO_ASEGURADO',         'Infecciones urinarias a repetición',             'Penicilina'),
    ('46000109', 'Ricardo',          'Ñique Benites',       '1978-02-25', 'M', '987 100 109', 'PENDIENTE_VALIDACION', '',                                               ''),
    ('46000110', 'Gabriela',         'Torres Lazo',         '2000-07-07', 'F', '987 100 110', 'ACTIVO',               'Gastritis crónica, migraña',                     ''),
    ('46000111', 'Pedro',            'Alarcón Vega',        '1968-09-19', 'M', '987 100 111', 'NO_ASEGURADO',         'Hipertensión arterial',                          ''),
    ('46000112', 'Sofía',            'Cáceres Mamani',      '2016-10-05', 'F', '987 100 112', 'NO_ASEGURADO',         '',                                               ''),
    ('46000113', 'Miguel Ángel',     'Ccori Huamán',        '1958-03-28', 'M', '987 100 113', 'ACTIVO',               'EPOC, exfumador',                                ''),
    ('46000114', 'Rosa Elvira',      'Chumpitaz León',      '1938-12-01', 'F', '987 100 114', 'ACTIVO',               'Artrosis de rodilla, hipotiroidismo',            'Penicilina y AINE'),
    ('46000115', 'Kevin',            'Loayza Ramos',        '2008-06-23', 'M', '987 100 115', 'NO_ASEGURADO',         '',                                               ''),
    ('46000116', 'Fernando',         'Rivas Ugarte',        '1972-01-14', 'M', '987 100 116', 'ACTIVO',               'Diabetes mellitus tipo 2',                       ''),
    ('46000117', 'Daniela',          'Herrera Ochoa',       '2021-09-12', 'F', '987 100 117', 'ACTIVO',               '',                                               ''),
    ('46000118', 'Hugo',             'Sánchez Paredes',     '1990-05-26', 'M', '987 100 118', 'PENDIENTE_VALIDACION', '',                                               '')
  ) as t(dni, nom, ape, nac, sexo, tel, sis, ant, alg)
  loop
    continue when exists (select 1 from public.paciente where tipo_documento = 'DNI' and numero_documento = r.dni);
    insert into public.paciente (tipo_documento, numero_documento, nombres, apellidos, fecha_nacimiento, sexo,
                                 telefono, condicion_sis, fecha_validacion_sis)
    values ('DNI', r.dni, r.nom, r.ape, r.nac::date, r.sexo, r.tel, r.sis, case when r.sis = 'ACTIVO' then now() end)
    returning id_paciente into v_pac;
    select coalesce(max(substring(numero_historia from '^HC-(\d+)$')::int), 0) + 1 into v_hc from public.historia_clinica;
    insert into public.historia_clinica (id_paciente, numero_historia, antecedentes_patologicos, alergias_medicamentosas, fecha_apertura)
    values (v_pac, 'HC-' || lpad(v_hc::text, 6, '0'), nullif(r.ant, ''), nullif(r.alg, ''), now() - interval '90 days');
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Atención anterior completa: llegada, pago (o SIS), triaje, cita, consulta, diagnóstico y receta.
-- Elige el último día (desde hace p_dias) en que el médico atiende, el primer cupo libre de su horario
-- y los correlativos siguientes de turno, boleta y receta. Si el paciente ya tiene un turno ese día, no hace nada.
-- La prioridad se calcula con los umbrales iniciales (los mismos de la app).
-- ---------------------------------------------------------------------
create or replace function pg_temp.visita(
  p_dni text, p_dias int, p_med text, p_enf text, p_caja text,
  p_pa text, p_fc int, p_fr int, p_t numeric, p_spo2 numeric, p_peso numeric, p_talla numeric,
  p_motivo text, p_notas text, p_dx text[], p_meds jsonb, p_dest text default 'Alta', p_destx text default '')
returns void language plpgsql as $$
declare
  v_pac uuid; v_hist uuid; v_sis text; v_med record; v_h record; v_fecha date; v_turno uuid;
  v_dur int; v_slot time; v_llega timestamptz; v_cita timestamptz; v_cod text; v_prio text; v_sys int;
  v_comp text; v_rec text; v_i int := 0;
begin
  select p.id_paciente, h.id_historia, p.condicion_sis into v_pac, v_hist, v_sis
    from public.paciente p join public.historia_clinica h using (id_paciente)
   where p.tipo_documento = 'DNI' and p.numero_documento = p_dni;
  select u.id_usuario, u.username, e.codigo esp, e.duracion_cita_min dur into v_med
    from public.usuario u join public.especialidad e on e.id_especialidad = u.id_especialidad where u.username = p_med;
  if v_pac is null then
    raise exception 'Falta el paciente %', p_dni;
  end if;
  if v_med.id_usuario is null then
    raise notice 'Atención omitida: falta el profesional % (ejecute actualizacion-v1.3.sql)', p_med;
    return;
  end if;

  -- Último día en que el médico atiende
  v_fecha := sgc_interno.hoy() - p_dias;
  loop
    select h.* into v_h from public.horario_medico h
     where h.id_usuario_medico = v_med.id_usuario and h.activo and h.dia_semana = extract(isodow from v_fecha)
     order by h.hora_inicio limit 1;
    exit when v_h.id_horario is not null;
    v_fecha := v_fecha - 1; v_i := v_i + 1;
    if v_i > 7 then raise exception 'El médico % no tiene horario', p_med; end if;
  end loop;
  if exists (select 1 from public.turno where id_paciente = v_pac and fecha_turno = v_fecha) then return; end if;

  -- Primer cupo libre del bloque
  v_dur := v_med.dur;
  v_slot := v_h.hora_inicio + make_interval(mins => v_dur);
  while exists (select 1 from public.cita c where c.id_usuario_medico = v_med.id_usuario and c.fecha_cita = v_fecha
                  and not c.es_sobrecupo and c.estado not in ('CANCELADA','NO_ASISTIO') and c.hora_cita = v_slot) loop
    v_slot := v_slot + make_interval(mins => v_dur);
  end loop;
  if v_slot + make_interval(mins => v_dur) > v_h.hora_fin then return; end if;
  v_cita := (v_fecha + v_slot) at time zone 'America/Lima';
  v_llega := v_cita - interval '45 minutes';

  -- Prioridad con los umbrales iniciales
  v_sys := split_part(p_pa, '/', 1)::int;
  v_prio := case
    when p_spo2 < 90 or p_t >= 40 or v_sys < 80 or p_fc > 130 or p_fc < 40 or p_fr > 30 or p_fr < 8 then 'CRITICA'
    when p_spo2 <= 93 or p_t >= 38.5 or v_sys >= 180 or p_fc > 110 or p_fr >= 25 then 'PRIORITARIA'
    else 'NORMAL' end;

  select 'TR-' || lpad((coalesce(max(substring(codigo_turno from '^TR-(\d+)$')::int), 0) + 1)::text, 3, '0') into v_cod
    from public.turno where fecha_turno = v_fecha;
  insert into public.turno (fecha_turno, codigo_turno, id_paciente, id_usuario_admision, id_area_destino, estado,
                            nivel_prioridad, hora_llegada, ts_inicio_triaje, ts_fin_triaje, ts_llamado_consulta,
                            ts_cierre, ts_ultimo_llamado, veces_llamado)
  values (v_fecha, v_cod, v_pac, sgc_interno.id_usuario('a.admision'), v_h.id_area, 'ATENDIDO', v_prio, v_llega,
          v_llega + interval '12 minutes', v_llega + interval '20 minutes', v_cita + interval '3 minutes',
          v_cita + interval '22 minutes', v_cita + interval '3 minutes', 1)
  returning id_turno into v_turno;

  if sgc_interno.exonerado(v_sis) then
    perform sgc_interno.guardar_pago(v_turno, jsonb_build_object('metodo', 'SIS', 'monto', 0),
                                     sgc_interno.id_usuario('a.admision'), v_llega);
  else
    select 'B001-' || lpad((coalesce(max(substring(numero_comprobante from '^B001-(\d+)$')::int), 0) + 1)::text, 6, '0')
      into v_comp from public.pago;
    perform sgc_interno.guardar_pago(v_turno, jsonb_build_object('metodo', 'EFECTIVO', 'monto', sgc_interno.tarifa(), 'comp', v_comp),
                                     sgc_interno.id_usuario(p_caja), v_llega + interval '4 minutes');
  end if;

  perform sgc_interno.guardar_signos(v_turno,
    jsonb_build_object('pa', p_pa, 'fc', p_fc, 'fr', p_fr, 't', p_t, 'spo2', p_spo2, 'peso', p_peso, 'talla', p_talla, 'motivo', p_motivo),
    sgc_interno.id_usuario(p_enf), v_llega + interval '20 minutes', v_prio);

  perform sgc_interno.guardar_cita(v_turno,
    jsonb_build_object('esp', v_med.esp, 'med', v_med.username, 'at', (extract(epoch from v_cita) * 1000)::bigint,
                       'sobre', false, 't', (extract(epoch from v_llega + interval '24 minutes') * 1000)::bigint),
    sgc_interno.id_usuario('a.admision'), v_prio, false);
  update public.cita set ts_llegada = v_llega + interval '24 minutes' where id_turno = v_turno;
  perform sgc_interno.cerrar_cita(v_turno, 'ATENDIDO', null);

  select 'REC-' || extract(year from v_fecha)::int || '-' ||
         lpad((coalesce(max(substring(codigo_receta from '^REC-\d{4}-(\d+)$')::int), 0) + 1)::text, 6, '0')
    into v_rec from public.receta_medica where codigo_receta like 'REC-' || extract(year from v_fecha)::int || '-%';
  perform sgc_interno.guardar_atencion(v_turno, v_hist,
    jsonb_build_object('notas', p_notas, 'dest', p_dest, 'destx', p_destx,
                       'dx', (select jsonb_agg(jsonb_build_array(d, '', 'D')) from unnest(p_dx) d),
                       'meds', p_meds, 'rec', case when jsonb_array_length(p_meds) > 0 then v_rec end),
    v_med.id_usuario, v_h.id_area, v_cita + interval '22 minutes', p_motivo);
end $$;

create or replace function pg_temp.m(n text, dosis text, frec text, dias int) returns jsonb
language sql immutable as $$ select jsonb_build_object('n', n, 'dosis', dosis, 'frec', frec, 'dias', dias, 'cant', '') $$;

-- Niña asmática (SIS): dos crisis leves atendidas en Pediatría
select pg_temp.visita('46000101', 40, 'm.pediatria', 'e.triaje', null, '95/60', 112, 28, 37.2, 94, 18.5, 1.08,
  'Tos y silbido en el pecho', 'Sibilancias espiratorias bilaterales, sin tiraje. Responde a nebulización.',
  array['J45.9'], jsonb_build_array(pg_temp.m('Salbutamol inhalador', '2 puff con aerocámara', 'cada 6 h', 5)));
select pg_temp.visita('46000101', 9, 'm.pediatria2', 'e.triaje2', null, '96/62', 104, 24, 36.9, 96, 19.0, 1.09,
  'Tos nocturna', 'Asma controlada parcialmente. Se refuerza técnica inhalatoria.',
  array['J45.9'], jsonb_build_array(pg_temp.m('Salbutamol inhalador', '2 puff con aerocámara', 'cada 8 h', 7)));
-- Adolescente (SIS): resfriado
select pg_temp.visita('46000103', 15, 'm.general3', 'e.triaje3', null, '108/68', 84, 18, 37.4, 98, 52.0, 1.58,
  'Congestión nasal y dolor de garganta', 'Faringe congestiva, sin exudado. Pulmones limpios.',
  array['J00'], jsonb_build_array(pg_temp.m('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3)));
-- Gestante (SIS): control en Ginecología
select pg_temp.visita('46000104', 21, 'm.gineco', 'e.triaje', null, '110/70', 82, 16, 36.6, 99, 64.0, 1.57,
  'Control prenatal, ardor al orinar', 'Gestante de 22 semanas. Sedimento urinario sugestivo de ITU baja.',
  array['N39.0'], jsonb_build_array(pg_temp.m('Nitrofurantoína 100 mg', '1 cápsula', 'cada 6 h', 7)));
-- Adulto mayor hipertenso y diabético, alérgico a AINE (SIS): Cardiología y control de glucosa
select pg_temp.visita('46000105', 33, 'm.cardio', 'e.triaje', null, '182/96', 88, 18, 36.5, 96, 78.0, 1.66,
  'Dolor de cabeza y presión alta', 'PA elevada en dos tomas. Sin signos de daño agudo de órgano blanco.',
  array['I10', 'R51'], jsonb_build_array(pg_temp.m('Enalapril 10 mg', '1 tableta', 'cada 12 h', 30), pg_temp.m('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3)));
select pg_temp.visita('46000105', 6, 'm.consulta', 'e.triaje3', null, '146/88', 80, 17, 36.6, 97, 77.5, 1.66,
  'Control de glucosa', 'Glucosa capilar 168 mg/dL. Se ajusta metformina y dieta.',
  array['E11.9', 'I10'], jsonb_build_array(pg_temp.m('Metformina 850 mg', '1 tableta', 'cada 12 h', 30)));
-- Adulta mayor con insuficiencia cardiaca, alérgica a penicilina (SIS): derivada a hospital
select pg_temp.visita('46000106', 18, 'm.cardio', 'e.triaje2', null, '150/92', 124, 26, 37.1, 91, 61.0, 1.52,
  'Falta de aire al caminar, piernas hinchadas', 'Crepitantes en bases, edema de miembros inferiores. Requiere evaluación hospitalaria.',
  array['I10'], '[]'::jsonb, 'Derivación a hospital', 'Hospital Nacional (demo)');
-- No asegurada, alérgica a penicilina: ITU, pagó en Caja
select pg_temp.visita('46000108', 26, 'm.consulta', 'e.triaje', 'c.caja', '112/72', 86, 16, 37.8, 98, 58.0, 1.60,
  'Ardor al orinar y dolor en bajo vientre', 'Puño percusión negativa. ITU baja no complicada.',
  array['N39.0'], jsonb_build_array(pg_temp.m('Nitrofurantoína 100 mg', '1 cápsula', 'cada 6 h', 5)));
-- SIS pendiente de validación (se atendió durante una caída del SIS): lumbago con reposo
select pg_temp.visita('46000109', 12, 'm.consulta2', 'e.triaje2', null, '128/82', 78, 16, 36.7, 98, 82.0, 1.72,
  'Dolor de espalda baja al cargar peso', 'Contractura paravertebral lumbar, Lasègue negativo.',
  array['M54.5'], jsonb_build_array(pg_temp.m('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 5)), 'Reposo médico', '3');
-- Paciente frecuente (SIS): tres atenciones
select pg_temp.visita('46000110', 38, 'm.general3', 'e.triaje3', null, '104/66', 76, 16, 36.6, 99, 55.0, 1.62,
  'Ardor en la boca del estómago', 'Dolor epigástrico a la palpación, sin signos de alarma.',
  array['K29.7'], jsonb_build_array(pg_temp.m('Omeprazol 20 mg', '1 cápsula', 'en ayunas', 14)));
select pg_temp.visita('46000110', 19, 'm.consulta', 'e.triaje', null, '110/70', 80, 16, 36.8, 99, 55.5, 1.62,
  'Dolor de cabeza intenso', 'Cefalea hemicraneal pulsátil sin focalización. Migraña sin aura.',
  array['R51'], jsonb_build_array(pg_temp.m('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3)));
select pg_temp.visita('46000110', 4, 'm.general3', 'e.triaje3', null, '106/68', 92, 18, 38.6, 96, 55.0, 1.62,
  'Fiebre, tos y dolor de garganta', 'Faringe eritematosa, fiebre. Cuadro viral.',
  array['J06.9'], jsonb_build_array(pg_temp.m('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3), pg_temp.m('Loratadina 10 mg', '1 tableta', 'cada 24 h', 5)));
-- No asegurado hipertenso: pagó con tarjeta, reposo
select pg_temp.visita('46000111', 14, 'm.consulta2', 'e.triaje2', 'c.caja2', '168/100', 90, 18, 36.6, 97, 88.0, 1.70,
  'Mareos y presión alta', 'Hipertensión no controlada, abandonó tratamiento.',
  array['I10'], jsonb_build_array(pg_temp.m('Enalapril 10 mg', '1 tableta', 'cada 12 h', 30)), 'Reposo médico', '2');
-- Niña no asegurada: diarrea, pagó en Caja
select pg_temp.visita('46000112', 8, 'm.pediatria', 'e.triaje', 'c.caja3', '98/60', 108, 22, 37.9, 98, 26.0, 1.25,
  'Diarrea y vómitos desde ayer', 'Deshidratación leve, abdomen blando. Tolera vía oral.',
  array['A09'], jsonb_build_array(pg_temp.m('Suero de rehidratación oral', '1 sobre en 1 litro', 'a libre demanda', 3)));
-- Adulto mayor con EPOC (SIS): neumonía con prioridad crítica, derivado
select pg_temp.visita('46000113', 10, 'm.consulta', 'e.triaje', null, '138/84', 118, 32, 39.2, 87, 70.0, 1.68,
  'Fiebre alta y falta de aire', 'Crepitantes en base derecha, SpO₂ baja. Neumonía adquirida en la comunidad.',
  array['J18.9'], jsonb_build_array(pg_temp.m('Azitromicina 500 mg', '1 tableta', 'cada 24 h', 3)), 'Derivación a hospital', 'Hospital Nacional (demo)');
-- Adulta mayor de 87 años, alérgica a penicilina y AINE (SIS)
select pg_temp.visita('46000114', 23, 'm.general3', 'e.triaje3', null, '132/78', 74, 16, 36.4, 95, 54.0, 1.48,
  'Dolor de espalda baja al levantarse', 'Dolor lumbar mecánico, sin irradiación. Artrosis conocida.',
  array['M54.5'], jsonb_build_array(pg_temp.m('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 7)));
-- Diabético (SIS): dos controles
select pg_temp.visita('46000116', 30, 'm.consulta', 'e.triaje', null, '124/80', 78, 16, 36.6, 98, 92.0, 1.71,
  'Control de diabetes', 'Glucosa en ayunas 182 mg/dL. Inicia metformina.',
  array['E11.9'], jsonb_build_array(pg_temp.m('Metformina 850 mg', '1 tableta', 'cada 12 h', 30)));
select pg_temp.visita('46000116', 2, 'm.general3', 'e.triaje3', null, '122/78', 76, 16, 36.5, 98, 90.0, 1.71,
  'Control de diabetes', 'Glucosa en ayunas 132 mg/dL. Buena adherencia.',
  array['E11.9'], jsonb_build_array(pg_temp.m('Metformina 850 mg', '1 tableta', 'cada 12 h', 30)));
-- Preescolar con fiebre (SIS): prioritaria
select pg_temp.visita('46000117', 5, 'm.pediatria2', 'e.triaje2', null, '94/58', 128, 26, 39.0, 96, 15.0, 0.98,
  'Fiebre de 39 °C desde la noche', 'Otoscopia normal, faringe congestiva. Cuadro viral.',
  array['B34.9', 'R50.9'], jsonb_build_array(pg_temp.m('Paracetamol 500 mg', '1/4 de tableta', 'cada 6 h', 3)));

-- ---------------------------------------------------------------------
-- Resto de la cartera de primer nivel (actualizacion-v1.3.sql)
-- ---------------------------------------------------------------------
-- Gestante (SIS): control prenatal con la obstetra
select pg_temp.visita('46000104', 7, 'm.obstetra', 'e.triaje', null, '108/68', 84, 16, 36.7, 99, 65.0, 1.57,
  'Control prenatal', 'Gestación de 24 semanas, altura uterina acorde, latidos fetales 144 lpm. Urocultivo de control negativo.',
  array['Z34.9'], jsonb_build_array(pg_temp.m('Ácido fólico 0.5 mg', '1 tableta', 'cada 24 h', 30), pg_temp.m('Sulfato ferroso 300 mg', '1 tableta', 'cada 24 h', 30)));
-- Lactante (SIS): control de crecimiento y desarrollo con enfermería CRED
select pg_temp.visita('46000102', 16, 'm.cred', 'e.triaje2', null, '90/55', 118, 30, 36.8, 98, 11.2, 0.82,
  'Control de crecimiento y desarrollo', 'Peso y talla en percentil 50. Hemoglobina 10.8 g/dL: anemia leve, se indica hierro.',
  array['Z00.1', 'D50.9'], jsonb_build_array(pg_temp.m('Sulfato ferroso 300 mg', '1/4 de tableta triturada', 'cada 24 h', 30)));
-- Paciente frecuente (SIS): odontología por dolor de muela
select pg_temp.visita('46000110', 11, 'm.odonto', 'e.triaje', null, '108/70', 80, 16, 36.6, 99, 55.0, 1.62,
  'Dolor de muela', 'Caries profunda en pieza 36 con sensibilidad al frío. Se realiza restauración provisional.',
  array['K02.9'], jsonb_build_array(pg_temp.m('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3), pg_temp.m('Clorhexidina 0.12 % enjuague', '15 ml', 'cada 12 h', 7)));
-- SIS pendiente de validación: primera sesión de psicología
select pg_temp.visita('46000118', 3, 'm.psicologia', 'e.triaje3', null, '122/78', 88, 18, 36.6, 98, 74.0, 1.73,
  'Ansiedad y problemas para dormir', 'Entrevista inicial: ansiedad por carga laboral e insomnio de conciliación. Pautas de higiene del sueño; seguimiento en 2 semanas.',
  array['F41.1'], '[]'::jsonb);
-- Diabético (SIS): plan de alimentación con nutrición
select pg_temp.visita('46000116', 9, 'm.nutricion', 'e.triaje2', null, '126/80', 78, 16, 36.5, 98, 91.0, 1.71,
  'Control de peso y alimentación', 'IMC 31.1. Plan de alimentación hipocalórico y conteo de carbohidratos.',
  array['E66.9', 'E11.9'], '[]'::jsonb);
-- Adulto mayor diabético (SIS): control en Medicina Interna
select pg_temp.visita('46000105', 13, 'm.interna', 'e.triaje2', null, '150/90', 82, 18, 36.6, 96, 78.0, 1.66,
  'Control de glucosa y colesterol', 'Glucosa en ayunas 156 mg/dL, LDL 168 mg/dL. Se agrega estatina.',
  array['E11.9', 'E78.5'], jsonb_build_array(pg_temp.m('Atorvastatina 20 mg', '1 tableta', 'cada 24 h', 30)));
-- No asegurado (pagó en Caja): chequeo preventivo con Medicina Familiar
select pg_temp.visita('46000107', 20, 'm.familiar', 'e.triaje', 'c.caja2', '124/80', 72, 16, 36.5, 98, 80.0, 1.75,
  'Chequeo preventivo anual', 'Examen físico normal. Se solicitan glucosa, perfil lipídico y examen de orina.',
  array['Z00.0'], '[]'::jsonb);
