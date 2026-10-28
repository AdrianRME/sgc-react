# SGC · Sistema de Gestión Clínica (PMV)

Sistema web para el flujo de atención de un centro de salud de primer nivel:
**Admisión → Caja → Triaje → Cita con el especialista → Consulta médica → Receta y alta**. Incluye la pantalla de la sala de espera, un tablero
gerencial para Jefatura y la historia clínica de cada paciente.

Hecho con **React 19 + Vite**, publicado en **Vercel**, con **Supabase** (PostgreSQL, Auth y Realtime) como servidor.

## Qué incluye

| Espacio | Secciones |
|---|---|
| Admisión (`#/admision`) | **Ventanilla**: registro por DNI o apellido en tres pasos (identificar, verificar SIS, turno) y llegada de los citados, con tarjetas por etapa que filtran a los pacientes del día. **Asignar citas** (respaldo, si Enfermería no la dio), **Agenda de citas** y flujo en vivo |
| Caja (`#/caja`) | Cobro de la consulta al no asegurado (efectivo con vuelto, tarjeta o billetera), boleta y caja del día. Con SIS no se cobra |
| Enfermería (`#/triaje`) | Cola de triaje; signos vitales con estado por signo, prioridad en vivo, IMC y tendencia de visitas anteriores; **al terminar, la cita** con la sugerencia del sistema y su constancia |
| Consulta (`#/consulta`) | Médicos y demás profesionales de consulta. Solo sus pacientes con cita que ya llegaron, por prioridad y hora de la cita; agenda del día; ficha, CIE-10, receta con control de alergias y destino; historias clínicas |
| Jefatura (`#/jefatura`) | Tablero gerencial, flujo en vivo (solo códigos), usuarios, **horarios médicos**, auditoría y umbrales clínicos |
| Sacar cita (`#/cita`, pública) | El paciente con historia reserva su cita con su DNI y su fecha de nacimiento: especialidad, día y hora según el horario del médico. Una cita activa a la vez; tras 5 intentos fallidos el DNI se bloquea 15 min. Admisión usa la misma pantalla para las citas por teléfono |
| Sala (`#/sala`, pública) | Llamado actual con tono y voz, próximos turnos con su **espera aproximada**; nunca muestra nombres ni DNI |

**Cartera de servicios de primer nivel (I-3/I-4)**, agrupada por ramas, con 8 consultorios y su color en la sala:

| Rama | Especialidades y servicios |
|---|---|
| Atención médica | Medicina General, Medicina Familiar, Medicina Interna, Cardiología |
| Materno-infantil | Pediatría, Crecimiento y Desarrollo (CRED), Ginecología y Obstetricia, Obstetricia |
| Salud bucal | Odontología |
| Salud mental y nutrición | Psicología, Nutrición |

El triaje propone la especialidad según el motivo y la edad (control prenatal a Obstetricia, dolor de muela a
Odontología, menores de 5 años en control a CRED, etc.), para que el paciente vaya directo al servicio que necesita
sin pasar antes por Medicina General: es parte del objetivo de reducir los tiempos de atención.

Comunes a todos los espacios:

- **Inicio de sesión por área.** Cada usuario empieza con el prefijo de su rol: `a.` Admisión, `c.` Caja,
  `e.` Enfermería, `m.` Médico y `j.` Jefatura. Al escribirlo, la pantalla muestra solo el ícono, el espacio y los
  pasos de esa área. Lo reconoce por el prefijo, sin consultar al servidor, así que no revela si la cuenta existe.
- **La ruta en vivo**, de Admisión a Alta, con los turnos que avanzan entre etapas.
- **Simulador del ciclo del paciente** (botón «Simulación», también en el inicio de sesión): recorre paso a paso
  ocho casos (nuevo con SIS, nuevo sin seguro, con historial y alergia, crítico, caída del SIS, caída del servidor,
  sin conexión y paciente que no se presenta). Ejecuta las mismas reglas del sistema sobre una copia de prueba de los
  datos: muestra estados, prioridad, cita, boleta, receta y rechazos reales sin tocar la base.
- **Sin conexión**: si el equipo pierde internet lo avisa de inmediato; un cambio que no se pudo guardar se deshace
  en pantalla, y al volver la red los datos se recargan solos.
- **Paleta de comandos** con <kbd>Ctrl</kbd> + <kbd>K</kbd>, para ir a cualquier sección o llamar al siguiente.
- **Centro de avisos** con lo que hacen las otras estaciones. Los casos críticos además aparecen como aviso emergente.
- **Tema claro u oscuro** y diseño adaptable a celular.
- **Accesibilidad.** Se respeta la preferencia de «reducir movimiento» del sistema y todos los gráficos se pueden
  leer con el teclado.

**Tablero gerencial.** Funciona con hechos anónimos, sin nombres, DNI ni historia. Incluye:

- **Cifras principales:** atendidos, tiempo total, esperas dentro del objetivo y abandono. Cada una se compara con
  el periodo anterior.
- **Gráficos:**
  - turnos por prioridad;
  - espera por día;
  - tiempo por etapa de la ruta;
  - demanda por día y hora (mapa de calor);
  - cumplimiento por prioridad;
  - morbilidad CIE-10;
  - destino de los pacientes;
  - perfil por etapas de vida (MINSA);
  - productividad por consultorio;
  - **afluencia prevista** para los próximos días.
- **Resumen en tabla** con exportación a CSV.

## Espera aproximada y afluencia prevista (RF-14 y RF-15)

**Espera aproximada (RF-14).** La fórmula es la del capítulo IV del informe:

```
espera = resto de la atención en curso + turnos por delante × tiempo medio
```

- **Colas:** hay un solo módulo de triaje, por orden de llegada. En consulta, cada médico tiene su cola, por
  prioridad y hora de la cita, y nadie pasa antes de su cita.
- **Tiempo medio:** el promedio de las últimas 20 atenciones del día en esa etapa (en consulta, las del mismo
  médico). Con menos de 3, se usa una referencia: 7 min en triaje y la duración del cupo en consulta.
- **Dónde se ve:**
  - en la pantalla de sala, como un rango de 5 minutos;
  - en el ticket y en la constancia de una cita para hoy;
  - en las tarjetas del flujo en vivo.
- **Dónde se calcula:** en `src/lib/espera.js` y, para la sala pública, en `sgc_interno.esperas()`.
- **Precisión:** `pruebas-carga/validar-espera.mjs` la mide con datos simulados (los supuestos del Anexo E):
  - espera de triaje: error medio de 3,8 min, frente a 27,4 min de la base;
  - espera de consulta: error medio de 2,9 min, frente a 8,1 min.

**Afluencia prevista (RF-15).** Está en el tablero de Jefatura y usa la línea base del informe: para cada hora, el
promedio de llegadas del mismo día de la semana en las 4 semanas anteriores.

- Muestra los próximos 6 días de atención, con su franja de mayor afluencia.
- Mide su propio error: prevé cada día de la última semana con las semanas anteriores a él y lo compara con lo que
  llegó.

## Pago y citas

1. **Admisión** registra al paciente. Si tiene SIS (o el SIS está en validación por contingencia), no paga y pasa a
   triaje. Si no tiene seguro, el turno queda **pendiente de pago**.
2. **Caja** cobra la consulta (S/ 20.00) y emite la boleta `B001-…`. Recién entonces el paciente entra a la lista de
   triaje: la base no deja llamar a triaje a quien no pagó.
3. **Triaje** registra los signos y calcula la prioridad. Ahí mismo, Enfermería confirma la cita que propone el sistema
   y entrega la constancia: el paciente no vuelve a Admisión. Si queda sin cita, Admisión la asigna en «Asignar
   citas».
4. **Citas**:
   - El sistema propone la especialidad: Pediatría para menores de 12 años, Cardiología si el motivo es
     cardiovascular y, si no, Medicina General.
   - También propone la cita, con los **horarios de los médicos** que define Jefatura. Cada bloque se divide en cupos
     de la duración de la especialidad (20 o 30 min).
   - **Normal:** el primer cupo libre de la especialidad, el día que sea. Si Cardiología solo atiende martes y jueves,
     a quien pasa por triaje un lunes le toca el martes.
   - **Prioritaria:** un cupo de hoy en la especialidad. Si hoy no atiende, Medicina General hoy.
   - **Crítica:** **sobrecupo hoy** con el médico que está atendiendo. Nunca otro día.
5. Si la cita es **hoy**, el paciente pasa a la espera de consulta. Si es **otro día**, el turno queda **citado**. Ese
   día, Admisión registra su llegada y el paciente pasa directo a la espera de su médico, sin pagar ni pasar de nuevo
   por triaje.
6. **Cita reservada por web o por teléfono** (`#/cita` o «Cita por teléfono» en la Agenda):
   - **Reserva:** el paciente con historia clínica elige especialidad, médico, día y hora en los cupos del horario.
     Nunca hay sobrecupo, porque sin triaje no hay prioridad.
   - **Día de la cita:** Admisión registra su llegada. Sin SIS paga en Caja; con SIS no paga. Pasa por triaje, que la
     regla 3 del informe exige, y del triaje va directo a la espera de su médico, sin volver a Admisión.
7. **Cómo se sabe quién entra con cita:**
   - Cada médico ve solo a los pacientes que tienen cita con él y ya llegaron.
   - La lista se ordena por prioridad clínica y luego por la hora de la cita.
   - Su espera cuenta desde la hora de la cita.
   - Nadie más puede llamar a sus pacientes, ni en la app ni en la base.

La lógica está en `src/lib/agenda.js`. La base la vuelve a validar en `sgc_interno.guardar_cita()`: horario, cupo
libre (índice único), prioridad y fechas.

**Diagrama en ERwin.** `erwin/sgc_modelo_erwin.sql` es el mismo modelo de 17 tablas en SQL Server 2005, para hacer
ingeniería inversa en CA ERwin r7. El archivo trae los pasos en su encabezado. La base real sigue siendo la de
Supabase.

## Arquitectura

```
Navegador (React 19 + Vite, desplegado en Vercel con cabeceras de seguridad)
   │  HTTPS · JWT de Supabase Auth
   ▼
Supabase
   ├─ Auth ............ cuentas, bcrypt, sesiones JWT
   ├─ API (PostgREST) . solo funciones: sgc_cargar · sgc_guardar · sgc_historia · sgc_indicadores
   │                    sgc_clave_cambiada · sgc_restablecer_demo(+_lote) · sgc_sala
   ├─ Realtime ........ cambios de turno/paciente/usuario/umbral/auditoría, filtrados por RLS
   └─ PostgreSQL ...... 17 tablas (13 del informe + especialidad, horario, pago y cita) + RLS por rol + reglas en funciones
```

- **Carga liviana.**
  - Cada estación carga solo los turnos de hoy y los que siguen abiertos.
  - La historia de un paciente se pide al abrirla, con `sgc_historia`, que solo pueden usar Enfermería y Medicina.
  - Los indicadores se piden por periodo, con `sgc_indicadores`, que solo puede usar Jefatura.
- **Una sola fuente de cálculo.**
  - Toda la agregación del tablero vive en `src/lib/analytics.js`.
  - Una prueba comprueba que Supabase y el modo local dan exactamente las mismas cifras.
- **Código por demanda.** Cada sección se descarga cuando se abre, y un rol nunca descarga el código de los demás.
  Los datos de demostración también se descargan solo al restablecerlos.
- **Capas del código.**
  - `lib/`: reglas puras.
  - `store/actions.js`: casos de uso.
  - `data/`: repositorios intercambiables.
  - `views/`: secciones.
  - La base vuelve a validar todo en `sgc_guardar()`.

Seguridad, despliegue y verificación: [`DESPLIEGUE.md`](DESPLIEGUE.md).

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 77 pruebas: lógica clínica, pago, agenda de citas, espera, afluencia, flujo, indicadores, avisos y seguridad
npm run lint       # oxlint, sin advertencias
npm run build      # versión de producción en /dist
```

Sin las variables de `.env`, la app arranca en **modo local de desarrollo**: guarda los datos en el navegador
y todas las cuentas usan la contraseña `Demo2026`. El sistema publicado usa siempre Supabase.

## Estructura

```
src/
  lib/                lógica pura, sin React (probada)
    clinical.js         prioridad de triaje, IMC, máquina de estados, alergias, colas, validaciones
    agenda.js           horarios, cupos libres, cita sugerida por prioridad y validación de citas y horarios
    analytics.js        indicadores del tablero (hechos anónimos → cifras, series, mapa de calor, CSV)
    activity.js         avisos para cada rol a partir de los cambios de datos
    constants.js        roles y secciones, ruta y etapas, estados, CIE-10, medicamentos, umbrales
    ids.js · format.js  correlativos por día (TR-), por año (REC-), boletas (B001-) y HC; formatos es-PE
    seed.js · seedHistory.js  demostración: 5 semanas de atenciones generadas con semilla fija
    motion.js           animaciones compartidas
    simulacion.js       casos del simulador: pasos que ejecutan las acciones reales sobre una copia de prueba
  store/              StoreProvider (sesión, carga, inactividad, avisos) · actions.js (reglas de negocio)
  data/               supabaseRepo (Auth + funciones sgc_*) · localRepo (desarrollo) · merge.js
  hooks/              consulta asíncrona, historia del paciente, tema, atajos, avisos, confirmación, documentos
  components/         marco (Shell), ruta en vivo, paleta de comandos, avisos, documentos, ui
    charts/           gráficos SVG propios: columnas, líneas, mapa de calor, barras, medidor, tendencia
  views/              Login, Admision, Citas, Caja, Triaje, Consulta, Historias, Flujo, Sala, jefatura/*
  styles/             tokens (claro y oscuro), base, componentes y marco
  assets/icons3d/     íconos 3D Fluent Emoji (Microsoft, licencia MIT)
supabase/schema.sql   17 tablas, cuentas y horarios demo, RLS por rol, funciones sgc_* y tiempo real
supabase/actualizacion-v1.3.sql  cartera de primer nivel: 11 especialidades, 8 consultorios y sus profesionales
supabase/datos-demo.sql  más personal y médicos con horario, y 18 pacientes por tipo de caso con su historia
erwin/                el mismo modelo en SQL Server 2005 para el diagrama en CA ERwin r7
vercel.json           cabeceras de seguridad (CSP, HSTS, X-Frame-Options…)
```

## Créditos

- **Íconos 3D:** [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) de Microsoft, con licencia MIT
  (`src/assets/icons3d/LICENSE-fluentui-emoji.txt`).
- **Íconos de interfaz:** [Lucide](https://lucide.dev), con licencia ISC.
- **Animaciones:** [Motion](https://motion.dev), con licencia MIT.
- **Tipografías:** Onest y Bricolage Grotesque, con licencia OFL. Se sirven desde el propio sitio, sin peticiones a
  terceros.
