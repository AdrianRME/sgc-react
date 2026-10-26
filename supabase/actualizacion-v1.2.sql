-- =====================================================================
-- Actualización v1.2 (para un proyecto que ya tiene supabase/schema.sql instalado)
--   · Espera aproximada en la pantalla de sala (RF-14).
--   · Enfermería da la cita al terminar el triaje.
--   · Cita por web o por teléfono con DNI y fecha de nacimiento (una a la vez);
--     el día de la cita el paciente pasa por Caja y triaje y va directo a su médico.
--   · La sala muestra a los citados de hoy aunque hayan sacado la cita días antes.
-- No borra ni cambia datos. Supabase → SQL Editor → pegar este archivo → Run.
-- (Una instalación nueva no lo necesita: schema.sql ya lo incluye.)
-- =====================================================================

create table if not exists sgc_interno.intento_cita (
    dni    varchar(15) not null,
    fecha  timestamptz not null default now()
);
create index if not exists ix_intento_cita on sgc_interno.intento_cita (dni, fecha);

create or replace function sgc_interno.transicion_valida(p_desde text, p_hacia text) returns boolean
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

create or replace function sgc_interno.rol_puede(p_rol text, p_desde text, p_hacia text) returns boolean
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

create or replace function sgc_interno.accion_auditoria(p_accion text, p_detalle text, out tabla text, out operacion text)
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

create or replace function sgc_interno.esperas() returns table (id_turno uuid, espera integer)
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

create or replace function public.sgc_sala() returns jsonb
language sql stable security definer set search_path = '' as $$
  -- Ya ordenado como se muestra: llamados (el último primero), consulta por prioridad y hora de la cita,
  -- triaje por llegada. No expone la prioridad ni la hora de llegada; sí la espera aproximada (RF-14).
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', t.codigo_turno,
           'state', sgc_interno.estado_app(t.estado, t.ts_fin_triaje),
           'calledAt', sgc_interno.ms(t.ts_ultimo_llamado),
           'dest', a.nombre,
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
  left join sgc_interno.esperas() es on es.id_turno = t.id_turno
  where t.estado in ('EN_ESPERA_TRIAJE','LLAMANDO','EN_ESPERA_CONSULTA')
    -- turnos de hoy o de ayer, y los citados para hoy aunque hayan sacado la cita días antes
    and (t.fecha_turno >= (now() at time zone 'America/Lima')::date - 1
         or c.fecha_cita = (now() at time zone 'America/Lima')::date) $$;

create or replace function sgc_interno.verificar_paciente(p_dni text, p_nac date) returns uuid
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

create or replace function sgc_interno.cita_activa(p_pac uuid) returns jsonb
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

create or replace function sgc_interno.llegada_reserva(p_turno uuid, p_exonerado boolean) returns void
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

create or replace function public.sgc_paciente_cita(p_dni text, p_nac date) returns jsonb
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

create or replace function public.sgc_cupos(p_esp text) returns jsonb
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

create or replace function public.sgc_reservar_cita(p_dni text, p_nac date, p_cita jsonb) returns jsonb
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
  if yo.id_usuario is not null and yo.rol = 'ADMISION' then
    v_autor := yo.id_usuario; v_canal := 'teléfono';
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

create or replace function public.sgc_guardar(cambios jsonb) returns void
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


-- Autor de las citas que el paciente reserva por la web (no puede iniciar sesión)
insert into public.usuario (username, password_hash, rol, nombre_completo, activo)
values ('a.citasweb', 'sin-acceso', 'ADMISION', 'Citas por web (sistema)', false)
on conflict (username) do nothing;

-- Permisos
revoke all on sgc_interno.intento_cita from public, anon, authenticated;
-- Las funciones internas nuevas no se ejecutan desde fuera (las reemplazadas conservan sus permisos)
revoke execute on function sgc_interno.esperas(), sgc_interno.verificar_paciente(text, date),
                           sgc_interno.cita_activa(uuid), sgc_interno.llegada_reserva(uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.sgc_guardar(jsonb), public.sgc_sala(), public.sgc_paciente_cita(text, date),
                           public.sgc_cupos(text), public.sgc_reservar_cita(text, date, jsonb) from public;
grant execute on function public.sgc_guardar(jsonb) to authenticated;
grant execute on function public.sgc_sala(), public.sgc_paciente_cita(text, date), public.sgc_cupos(text),
                          public.sgc_reservar_cita(text, date, jsonb) to anon, authenticated;
