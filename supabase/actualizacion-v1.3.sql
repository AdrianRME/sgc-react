-- =====================================================================
-- Actualización v1.3: cartera completa de un establecimiento de primer nivel (I-3/I-4)
-- (para un proyecto que ya tiene schema.sql y actualizacion-v1.2.sql instalados)
--   · Especialidades y servicios agrupados por rama (las ramas solo agrupan en pantalla):
--       Atención médica:          Medicina General, Medicina Familiar, Medicina Interna, Cardiología
--       Materno-infantil:         Pediatría, Crecimiento y Desarrollo (CRED), Ginecología y Obstetricia, Obstetricia
--       Salud bucal:              Odontología
--       Salud mental y nutrición: Psicología, Nutrición
--   · Consultorios 5 a 8, un profesional de cada servicio nuevo con su horario semanal y diagnósticos
--     CIE-10 propios del primer nivel (control prenatal, CRED, caries, ansiedad, obesidad…).
-- No cambia tablas ni columnas (el modelo de ERwin sigue igual): solo agrega filas a los catálogos.
-- No borra ni cambia datos y se puede volver a ejecutar. Supabase → SQL Editor → pegar este archivo → Run.
-- EJECÚTELO ANTES de publicar la versión de la app que trae estas especialidades.
-- Contraseña de las cuentas nuevas: Demo2026.
-- =====================================================================

insert into public.especialidad (codigo, nombre, duracion_cita_min) values
  ('MF',   'Medicina Familiar', 20),
  ('MI',   'Medicina Interna', 30),
  ('CRED', 'Crecimiento y Desarrollo', 30),
  ('OBS',  'Obstetricia', 30),
  ('ODO',  'Odontología', 30),
  ('PSI',  'Psicología', 40),
  ('NUT',  'Nutrición', 30)
on conflict (codigo) do nothing;

insert into public.area_atencion (nombre, tipo) values
  ('Consultorio 5', 'CONSULTORIO'), ('Consultorio 6', 'CONSULTORIO'),
  ('Consultorio 7', 'CONSULTORIO'), ('Consultorio 8', 'CONSULTORIO')
on conflict (nombre) do nothing;

insert into public.diagnostico_cie10 (codigo_cie10, descripcion) values
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
  ('E66.9', 'Obesidad, no especificada')
on conflict (codigo_cie10) do nothing;

-- Profesionales de consulta (rol MEDICO: el espacio de Consulta). Cada uno con la colegiatura de su colegio:
-- CMP médicos, COP obstetras y odontólogos, CEP enfermería (CRED), CPsP psicólogos y CNP nutricionistas.
insert into public.usuario (username, password_hash, rol, nombre_completo, colegiatura, activo, id_especialidad)
select x.usr, 'pendiente', 'MEDICO', x.nombre, x.col, true, e.id_especialidad
from (values
  ('m.familiar',   'Dr. Ernesto Llanos (demo)',      'CMP-00013',  'MF'),
  ('m.interna',    'Dra. Liliana Pacheco (demo)',    'CMP-00014',  'MI'),
  ('m.obstetra',   'Obst. Milagros Cárdenas (demo)', 'COP-00001',  'OBS'),
  ('m.cred',       'Lic. Enf. Judith Arce (demo)',   'CEP-00006',  'CRED'),
  ('m.odonto',     'C.D. Renato Valdivia (demo)',    'COP-10001',  'ODO'),
  ('m.odonto2',    'C.D. Andrea Monzón (demo)',      'COP-10002',  'ODO'),
  ('m.psicologia', 'Ps. Diana Ugaz (demo)',          'CPsP-00001', 'PSI'),
  ('m.nutricion',  'Lic. Nut. Pablo Herrera (demo)', 'CNP-00001',  'NUT')
) as x(usr, nombre, col, esp)
join public.especialidad e on e.codigo = x.esp
on conflict (username) do nothing;

select sgc_interno.fijar_credencial(u.username, 'Demo2026', false)
from public.usuario u
where u.username in ('m.familiar', 'm.interna', 'm.obstetra', 'm.cred', 'm.odonto', 'm.odonto2', 'm.psicologia', 'm.nutricion')
  and not exists (select 1 from auth.users a where lower(a.email) = lower(u.username || '@' || sgc_interno.dominio()));

-- Horarios en los consultorios nuevos (5 a 8): mañana y tarde, de lunes a viernes (Obstetricia y Odontología
-- también el sábado por la mañana). guardar_horario impide cruces; un bloque que choque se omite con un aviso.
do $$
declare r record;
begin
  for r in
    select x.usr, x.area, x.ini, x.fin, d.dia
    from (values
      ('m.familiar',   'Consultorio 5', '07:00', '13:00', array[1,2,3,4,5]),
      ('m.interna',    'Consultorio 5', '13:00', '19:00', array[1,2,3,4,5]),
      ('m.obstetra',   'Consultorio 6', '07:00', '13:00', array[1,2,3,4,5,6]),
      ('m.cred',       'Consultorio 6', '13:00', '18:00', array[1,2,3,4,5]),
      ('m.odonto',     'Consultorio 7', '07:00', '13:00', array[1,2,3,4,5,6]),
      ('m.odonto2',    'Consultorio 7', '13:00', '19:00', array[1,2,3,4,5]),
      ('m.psicologia', 'Consultorio 8', '08:00', '14:00', array[1,2,3,4,5]),
      ('m.nutricion',  'Consultorio 8', '14:00', '19:00', array[1,2,3,4,5])
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
