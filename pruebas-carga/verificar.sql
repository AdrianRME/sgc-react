-- Verificación de integridad y métricas después de la prueba de carga (datos ficticios).
\pset footer off
\echo '== Turnos por estado'
select estado, count(*) from public.turno group by estado order by 2 desc;

\echo '== Prioridad asignada por la base en triaje'
select nivel_prioridad, count(*) from public.turno where ts_fin_triaje is not null group by 1 order by 2 desc;

\echo '== Controles de integridad (todos deben ser 0)'
select 'codigos de turno repetidos en el dia' control, count(*) from (
  select fecha_turno, codigo_turno from public.turno group by 1, 2 having count(*) > 1) x
union all select 'turnos ATENDIDO sin atencion_medica', count(*) from public.turno t
  where t.estado = 'ATENDIDO' and not exists (select 1 from public.atencion_medica a where a.id_turno = t.id_turno)
union all select 'atenciones sin receta', count(*) from public.atencion_medica a
  where not exists (select 1 from public.receta_medica r where r.id_atencion = a.id_atencion)
union all select 'recetas con codigo repetido', count(*) from (select codigo_receta from public.receta_medica group by 1 having count(*) > 1) x
union all select 'turnos con mas de un pago', count(*) from (select id_turno from public.pago group by 1 having count(*) > 1) x
union all select 'turnos sin seguro atendidos sin pago', count(*) from public.turno t join public.paciente p using (id_paciente)
  where p.condicion_sis = 'NO_ASEGURADO' and t.estado = 'ATENDIDO' and not exists (select 1 from public.pago g where g.id_turno = t.id_turno)
union all select 'turnos con mas de un triaje', count(*) from (select id_turno from public.signos_vitales group by 1 having count(*) > 1) x
union all select 'consultas atendidas sin cita', count(*) from public.turno t
  where t.estado = 'ATENDIDO' and not exists (select 1 from public.cita c where c.id_turno = t.id_turno)
union all select 'pacientes con dos turnos activos', count(*) from (select id_paciente from public.turno
  where estado not in ('ATENDIDO','CANCELADO') group by 1 having count(*) > 1) x
union all select 'marcas de tiempo fuera de secuencia', count(*) from public.turno
  where ts_cierre < hora_llegada or ts_fin_triaje < ts_inicio_triaje;

\echo '== Registros de auditoria por accion'
select operacion, tabla_afectada, count(*) from public.auditoria group by 1, 2 order by 3 desc;

\echo '== Duracion de la jornada simulada'
select min(hora_llegada) primera_llegada, max(ts_cierre) ultimo_cierre,
       round(extract(epoch from max(ts_cierre) - min(hora_llegada)) / 60, 1) minutos,
       count(*) filter (where estado = 'ATENDIDO') atendidos
from public.turno where id_paciente in (select id_paciente from public.paciente where apellidos like 'Simulado%');

\echo '== Tiempos por etapa registrados por la base (segundos, jornada comprimida)'
select 'llegada -> llamado a triaje' etapa, round(percentile_cont(0.5) within group (order by extract(epoch from ts_inicio_triaje - hora_llegada))::numeric, 1) mediana,
       round(percentile_cont(0.95) within group (order by extract(epoch from ts_inicio_triaje - hora_llegada))::numeric, 1) p95
from public.turno t join public.paciente p using (id_paciente) where p.apellidos like 'Simulado%' and ts_inicio_triaje is not null
union all
select 'llamado a triaje -> fin de triaje', round(percentile_cont(0.5) within group (order by extract(epoch from ts_fin_triaje - ts_inicio_triaje))::numeric, 1),
       round(percentile_cont(0.95) within group (order by extract(epoch from ts_fin_triaje - ts_inicio_triaje))::numeric, 1)
from public.turno t join public.paciente p using (id_paciente) where p.apellidos like 'Simulado%' and ts_fin_triaje is not null
union all
select 'llamado a consulta -> cierre', round(percentile_cont(0.5) within group (order by extract(epoch from ts_cierre - ts_llamado_consulta))::numeric, 1),
       round(percentile_cont(0.95) within group (order by extract(epoch from ts_cierre - ts_llamado_consulta))::numeric, 1)
from public.turno t join public.paciente p using (id_paciente) where p.apellidos like 'Simulado%' and t.estado = 'ATENDIDO'
union all
select 'llegada -> cierre (total)', round(percentile_cont(0.5) within group (order by extract(epoch from ts_cierre - hora_llegada))::numeric, 1),
       round(percentile_cont(0.95) within group (order by extract(epoch from ts_cierre - hora_llegada))::numeric, 1)
from public.turno t join public.paciente p using (id_paciente) where p.apellidos like 'Simulado%' and t.estado = 'ATENDIDO';
