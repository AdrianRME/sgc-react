-- =====================================================================
-- SGC · ACTUALIZACIÓN PMV 3 (todo en un solo archivo)
-- Para el Supabase que ya tiene actualizacion-unica.sql y actualizacion-v2.3.sql (el PMV v2.3 publicado).
-- Supabase → SQL Editor → pegar TODO este archivo → Run. Ejecútelo ANTES de publicar el PMV 3.
--
-- Reúne, en este orden, los dos archivos que faltaban:
--   PARTE 1 · actualizacion-v2.4.sql: varios módulos de triaje, uno por enfermera.
--   PARTE 2 · actualizacion-v3.0.sql: portal del paciente «Mi atención» (código de un solo uso).
--
-- No borra pacientes, turnos ni usuarios y se puede volver a ejecutar sin errores.
-- Si Supabase avisa «Potential issues detected», elija «Run and enable RLS»: la única tabla nueva
-- (sgc_interno.codigo_portal) es interna y este mismo archivo ya le activa esa protección.
-- La PARTE 2 no se ha probado contra una base: si da error, copie el mensaje completo.
-- =====================================================================


-- #####################################################################
-- PARTE 1 · v2.4
-- #####################################################################

-- =====================================================================
-- SGC · ACTUALIZACIÓN v2.4 (para el Supabase ya actualizado con actualizacion-v2.3.sql).
-- Supabase → SQL Editor → pegar TODO este archivo → Run. Ejecútelo ANTES de publicar la versión 2.4.
--
-- Varios módulos de triaje: cada enfermera atiende en su módulo, a un paciente a la vez, y varias
-- enfermeras atienden la misma cola al mismo tiempo (antes había un solo módulo para todo el centro).
--   1. Áreas: se agregan los módulos de triaje 2 a 5.
--   2. Índice: «un paciente en triaje» pasa a ser «un paciente en triaje por módulo».
--   3. sgc_guardar: un módulo con un paciente en triaje no llama a otro, y un paciente llamado a un
--      módulo no se vuelve a llamar desde otro (igual que en los consultorios, CR-06).
--   4. Espera aproximada (sala): la cola de triaje se reparte entre las enfermeras activas.
--
-- No cambia tablas ni columnas (el modelo de datos y su ERwin no cambian). No borra datos y se puede
-- volver a ejecutar sin errores.
-- =====================================================================

-- 1. Módulos de triaje 2 a 5 -----------------------------------------------
insert into public.area_atencion (nombre, tipo) values
  ('Módulo de Triaje 2', 'TRIAJE'), ('Módulo de Triaje 3', 'TRIAJE'),
  ('Módulo de Triaje 4', 'TRIAJE'), ('Módulo de Triaje 5', 'TRIAJE')
on conflict (nombre) do nothing;

-- 2. Un paciente en triaje por módulo ---------------------------------------
drop index if exists public.uq_turno_triaje_ocupado;
create unique index uq_turno_triaje_ocupado on public.turno (id_area_destino)
    where estado = 'EN_TRIAJE';

-- 3. Funciones (las mismas de supabase/schema.sql) ---------------------------
create or replace function public.sgc_guardar(cambios jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  yo record; r jsonb; tri jsonb;
  v_pac uuid; v_hist uuid; v_turno uuid; t record;
  v_desde text; v_hacia text; v_area uuid; v_area_tipo text; v_prio text; v_pa text[];
  v_exon boolean; v_fecha date; v_urg text; v_pref text;
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
      -- Urgencia (signo de alarma): pasa a triaje sin cobro previo (Ley N.° 26842, art. 3) y paga después
      v_urg := nullif(trim(coalesce(r->>'urg', '')), '');
      if v_urg is not null and not sgc_interno.signo_alarma_valido(v_urg) then
        raise exception 'Signo de alarma no válido: %', v_urg using errcode = 'P0001';
      end if;
      if v_hacia is distinct from (case when v_exon or v_urg is not null then 'EN_ESPERA_TRIAJE' else 'PENDIENTE_PAGO' end) then
        raise exception 'Un turno nuevo empieza %.',
          case when v_exon then 'en espera de triaje (SIS: no paga)'
               when v_urg is not null then 'en espera de triaje (urgencia: paga después)'
               else 'pendiente de pago en Caja' end using errcode = 'P0001';
      end if;
      -- Atención preferente: se guarda solo la que marca Admisión; la de la edad la deduce la base
      v_pref := case when r->>'pref' in ('GESTANTE','DISCAPACIDAD') then r->>'pref' end;
      if v_pref = 'GESTANTE' and (select sexo from public.paciente where id_paciente = v_pac) <> 'F' then
        raise exception 'Solo una paciente mujer puede registrarse como gestante.' using errcode = 'P0001';
      end if;
      insert into public.turno (fecha_turno, codigo_turno, id_paciente, id_usuario_admision, hora_llegada, estado,
                                signo_alarma, atencion_preferente)
      values (sgc_interno.hoy(), r->>'id', v_pac, yo.id_usuario, now(), v_hacia, v_urg, v_pref)
      returning id_turno into v_turno;
      if v_exon then
        perform sgc_interno.guardar_pago(v_turno, '{"metodo": "SIS", "monto": 0}'::jsonb, yo.id_usuario, now());
      end if;
      continue;
    end if;

    v_desde := t.estado_app;
    -- Cobro posterior de una urgencia: Caja registra el pago sin cambiar el estado del turno
    if yo.rol = 'CAJA' and v_hacia = v_desde and t.signo_alarma is not null and jsonb_typeof(r->'pago') = 'object'
       and not exists (select 1 from public.pago where id_turno = t.id_turno) then
      if coalesce(r->'pago'->>'metodo', '') not in ('EFECTIVO','TARJETA','BILLETERA') then
        raise exception 'Medio de pago no válido.' using errcode = 'P0001';
      end if;
      if coalesce(r->'pago'->>'comp', '') !~ '^B001-[0-9]{6}$' then
        raise exception 'Número de boleta no válido.' using errcode = 'P0001';
      end if;
      perform sgc_interno.guardar_pago(t.id_turno, jsonb_build_object('metodo', r->'pago'->>'metodo',
                'monto', sgc_interno.tarifa(), 'comp', r->'pago'->>'comp'), yo.id_usuario, now());
      continue;
    end if;
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
      if v_desde = v_hacia and v_area <> t.id_area_destino then
        raise exception '% ya fue llamado a %.', r->>'id', t.area_nombre using errcode = 'P0001';
      end if;
      -- CR-06: no se llama a otro paciente mientras el consultorio (o el módulo de triaje) tiene una atención abierta
      if exists (select 1 from public.turno o
                  where o.estado = case when v_hacia = 'LLAMADO_CONSULTA' then 'EN_CONSULTA' else 'EN_TRIAJE' end
                    and o.id_area_destino = v_area and o.id_turno <> t.id_turno) then
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

create or replace function sgc_interno.esperas() returns table (id_turno uuid, espera integer)
language sql stable set search_path = '' as $$
  with desde as (select ((now() at time zone 'America/Lima')::date)::timestamp at time zone 'America/Lima' as t),
  tri_d as (
    select extract(epoch from t.ts_fin_triaje - t.ts_inicio_triaje) / 60 as d,
           row_number() over (order by t.ts_fin_triaje desc) as n
      from public.turno t, desde
     where t.ts_inicio_triaje is not null and t.ts_fin_triaje >= desde.t and t.ts_fin_triaje <= now()),
  tri_m as (select case when count(*) >= 3 then avg(d) filter (where n <= 20) else 7 end as m from tri_d),
  -- v2.4: la cola de triaje la atienden tantos módulos como enfermeras activas (al menos 1, a lo más 5)
  tri_c as (
    select greatest(1, least(5, count(*))) as c from public.usuario where rol = 'ENFERMERIA' and activo),
  tri_ocupado as (
    select coalesce(sum(greatest(1, m.m - extract(epoch from now() - t.ts_inicio_triaje) / 60)), 0) as r
      from public.turno t, tri_m m
     where t.estado = 'EN_TRIAJE' or (t.estado = 'LLAMANDO' and t.ts_fin_triaje is null)),
  tri as (
    select t.id_turno, ((row_number() over (order by (t.signo_alarma is null),
                        (sgc_interno.preferente(t.atencion_preferente, p.fecha_nacimiento, t.hora_llegada) is null),
                        t.hora_llegada) - 1) * m.m + o.r) / k.c as e
      from public.turno t join public.paciente p on p.id_paciente = t.id_paciente, tri_m m, tri_ocupado o, tri_c k
     where t.estado = 'EN_ESPERA_TRIAJE'),
  cola as (
    select t.id_turno, c.id_usuario_medico as med, e.duracion_cita_min as ref,
           (c.fecha_cita + c.hora_cita) at time zone 'America/Lima' as hora,
           row_number() over (partition by c.id_usuario_medico
                              order by array_position(array['CRITICA','PRIORITARIA','NORMAL']::text[], t.nivel_prioridad::text),
                                       (sgc_interno.preferente(t.atencion_preferente, p.fecha_nacimiento, t.hora_llegada) is null),
                                       greatest(c.ts_llegada, (c.fecha_cita + c.hora_cita) at time zone 'America/Lima'),
                                       t.hora_llegada) - 1 as i
      from public.turno t
      join public.paciente p on p.id_paciente = t.id_paciente
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


-- #####################################################################
-- PARTE 2 · v3.0
-- #####################################################################

-- =====================================================================
-- SGC · ACTUALIZACIÓN v3.0 (para el Supabase ya actualizado con actualizacion-v2.4.sql).
-- Supabase → SQL Editor → pegar TODO este archivo → Run. Ejecútelo ANTES de publicar la versión 3.0.
--
-- Portal del paciente («Mi atención», #/paciente): el paciente consulta su cita, sus atenciones y sus
-- recetas. Como son datos clínicos, entra en dos pasos:
--   1. DNI + fecha de nacimiento  → sgc_portal_codigo: genera un código de 6 dígitos de un solo uso,
--      válido 5 minutos, y lo «envía» al celular registrado.
--   2. Ese código                 → sgc_portal_entrar: lo verifica (3 intentos) y entrega sus datos.
--
-- Qué entrega: su ficha, sus turnos y los nombres de los profesionales. Nunca las notas clínicas del
-- médico (anamnesis y examen) ni el motivo que contó en triaje. Cada ingreso queda en la auditoría.
--
-- Cambio en el modelo: una tabla interna nueva, sgc_interno.codigo_portal (no es una entidad del negocio:
-- guarda el código cifrado mientras está vigente). Las 13 tablas del modelo y su ERwin no cambian.
-- No borra datos y se puede volver a ejecutar sin errores.
--
-- PENDIENTE PARA PRODUCCIÓN: no hay proveedor de SMS conectado. Por eso sgc_portal_codigo devuelve el
-- código en el campo «demo» y la página lo muestra como «mensaje simulado». Al conectar un proveedor,
-- se envía el mensaje desde aquí y se quita ese campo de la respuesta.
--
-- ESTE SCRIPT NO SE HA PROBADO CONTRA UNA BASE: pruébelo primero en un proyecto de Supabase de prueba.
-- =====================================================================

-- 1. Código vigente de cada paciente (cifrado con bcrypt, igual que las contraseñas) ----------------
create table if not exists sgc_interno.codigo_portal (
    id_paciente  uuid        primary key references public.paciente (id_paciente) on delete cascade,
    hash         text        not null,
    vence        timestamptz not null,
    intentos     smallint    not null default 0
);

-- La tabla es interna: nadie la lee ni la escribe desde la aplicación, solo las dos funciones de abajo
-- (igual que sgc_interno.intento_cita). Se le quitan los permisos y se le activa la seguridad por filas.
revoke all on sgc_interno.codigo_portal from public, anon, authenticated;
alter table sgc_interno.codigo_portal enable row level security;

-- 2. Paso 1: identifica al paciente y genera su código ------------------------------------------------
-- Reutiliza sgc_interno.verificar_paciente: tras 5 intentos fallidos en 15 minutos el DNI se bloquea.
create or replace function public.sgc_portal_codigo(p_dni text, p_nac date) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pac uuid; v_tel text; v_cod text;
begin
  v_pac := sgc_interno.verificar_paciente(p_dni, p_nac);
  if v_pac is null then
    return jsonb_build_object('error', 'No encontramos un paciente con ese DNI y esa fecha de nacimiento. '
                                       'Si es su primera atención, acérquese a Admisión para abrir su historia clínica.');
  end if;
  select regexp_replace(coalesce(telefono, ''), '\D', '', 'g') into v_tel from public.paciente where id_paciente = v_pac;
  if length(v_tel) < 6 then
    return jsonb_build_object('error', 'No tiene un celular registrado. Acérquese a Admisión con su DNI para registrarlo.');
  end if;
  -- Seis dígitos a partir de bytes aleatorios criptográficos (pgcrypto)
  v_cod := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into sgc_interno.codigo_portal (id_paciente, hash, vence, intentos)
  values (v_pac, extensions.crypt(v_cod, extensions.gen_salt('bf', 6)), now() + interval '5 minutes', 0)
  on conflict (id_paciente) do update set hash = excluded.hash, vence = excluded.vence, intentos = 0;
  return jsonb_build_object('tel', '••• ••• ' || right(v_tel, 3), 'min', 5,
                            'demo', v_cod);   -- prototipo sin SMS: ver la nota de la cabecera
end $$;

-- 3. Paso 2: verifica el código y entrega los datos del paciente --------------------------------------
create or replace function public.sgc_portal_entrar(p_dni text, p_codigo text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_pac uuid; v_cod sgc_interno.codigo_portal%rowtype; v_hc text;
begin
  select id_paciente into v_pac from public.paciente where tipo_documento = 'DNI' and numero_documento = p_dni;
  select * into v_cod from sgc_interno.codigo_portal where id_paciente = v_pac for update;
  if v_pac is null or v_cod.id_paciente is null then
    return jsonb_build_object('error', 'Pida primero su código.', 'agotado', true);
  end if;
  if v_cod.vence < now() then
    delete from sgc_interno.codigo_portal where id_paciente = v_pac;
    return jsonb_build_object('error', 'El código venció (dura 5 minutos). Pida uno nuevo.', 'agotado', true);
  end if;
  if v_cod.hash <> extensions.crypt(trim(coalesce(p_codigo, '')), v_cod.hash) then
    if v_cod.intentos + 1 >= 3 then
      delete from sgc_interno.codigo_portal where id_paciente = v_pac;
      return jsonb_build_object('error', 'Código incorrecto. Por seguridad, pida un código nuevo.', 'agotado', true);
    end if;
    update sgc_interno.codigo_portal set intentos = intentos + 1 where id_paciente = v_pac;
    return jsonb_build_object('error', 'Código incorrecto. Le quedan ' || (2 - v_cod.intentos) || ' intento(s).', 'agotado', false);
  end if;
  delete from sgc_interno.codigo_portal where id_paciente = v_pac;   -- un solo uso

  -- Queda en la auditoría como cualquier lectura de historia; la registra el usuario del sistema de la web
  select h.numero_historia into v_hc from public.historia_clinica h where h.id_paciente = v_pac;
  perform sgc_interno.guardar_auditoria(
            (select id_usuario from public.usuario where username = 'a.citasweb'), 'HC_CONSULTADA',
            coalesce(v_hc, 'Historia') || ' consultada por el propio paciente (portal)',
            sgc_interno.ip_cliente(), now());

  return jsonb_build_object(
    'patient', (select jsonb_build_object(
                  'dni', p.numero_documento, 'nom', p.nombres, 'ape', p.apellidos,
                  'nac', to_char(p.fecha_nacimiento, 'YYYY-MM-DD'), 'sis', p.condicion_sis,
                  'hc', h.numero_historia, 'alg', coalesce(h.alergias_medicamentosas, ''))
                from public.paciente p join public.historia_clinica h on h.id_paciente = p.id_paciente
               where p.id_paciente = v_pac),
    -- Sus turnos, sin las notas clínicas del médico ni el motivo que contó en triaje
    'turns', coalesce((select jsonb_agg(t #- '{consult,notas}' #- '{tri,motivo}')
                         from jsonb_array_elements(sgc_interno.turnos_json(null, p_dni)) t), '[]'::jsonb),
    -- Nombres de los profesionales de consulta (dato público: es el mismo de «Sacar cita»)
    'users', coalesce((select jsonb_agg(jsonb_build_object('u', u.username, 'n', u.nombre_completo))
                         from public.usuario u where u.rol = 'MEDICO'), '[]'::jsonb));
end $$;

-- 4. Permisos: las dos funciones se llaman sin sesión (como «Sacar cita») ------------------------------
revoke all on function public.sgc_portal_codigo(text, date), public.sgc_portal_entrar(text, text) from public;
grant execute on function public.sgc_portal_codigo(text, date), public.sgc_portal_entrar(text, text) to anon, authenticated;
