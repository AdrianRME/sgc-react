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
