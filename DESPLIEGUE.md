# Despliegue: Supabase + Vercel

Guía para publicar el sistema con la base de datos y la autenticación en Supabase y la aplicación en Vercel.

**Cómo se probó.** `npm test` pasa las 57 pruebas, `npm run lint` no da advertencias y `npm run build` compila sin
errores.

**Espera aproximada (25 de octubre de 2026).** El mismo banco de PGlite comprobó que `sgc_sala()` entrega para cada
turno en cola la misma espera que calcula la app, con 4 de 4 turnos iguales (32 comprobaciones aprobadas).

**Pago, citas y horarios (octubre 2026).** `supabase/schema.sql` se ejecutó completo en PostgreSQL 16 (PGlite), con
`auth`, los roles y la publicación de tiempo real de Supabase simulados. Una batería de 31 comprobaciones generó los
cambios con las mismas reglas de la app y verificó:

- que la demostración importada (unos 620 turnos con pago y cita) vuelve igual por `sgc_cargar`;
- que `sgc_indicadores` da las mismas cifras que el modo local;
- el cobro en Caja y la exoneración por SIS;
- la cita según el horario y el sobrecupo de un crítico;
- la llegada del citado y la consulta con su médico;
- los cruces de horario;
- los rechazos en el servidor: pago no válido, hora fuera de cupo, doble reserva, crítico citado otro día, médico
  que llama al paciente de otro y rol sin permiso.

Lo que sigue describe la verificación anterior a este cambio. `supabase/schema.sql` se ejecutó en PostgreSQL 16 con el esquema real de Supabase Auth (migraciones del
repositorio `supabase/auth`, sept. 2026) y los roles de Supabase simulados, con tres baterías de prueba:

- **32 pruebas de seguridad y flujo.** Cubren:
  - qué ve cada rol, qué puede hacer y que no puede falsificar datos;
  - la historia clínica y los indicadores anónimos;
  - la carga de la demostración por partes;
  - el código de turno que se reinicia cada día.
- **14 pruebas de punta a punta en el navegador.** Se usa la app compilada contra un servidor que imita Supabase Auth
  y la API de datos. Cubren el tablero, el flujo en vivo, el registro, el triaje, la consulta, la historia, la sala
  y las contraseñas.
- **Dos pruebas de consistencia:**
  - La prioridad que calcula la base coincide con la de la app en 400 combinaciones de signos vitales.
  - El tablero da las mismas cifras con Supabase que en modo local.

No se probó contra un proyecto de Supabase real. Siga el paso 7 para verificarlo.

## 1. Código en GitHub

Cada `git push` a `main` vuelve a publicar el sitio en Vercel automáticamente.

## 2. Instalar la base de datos

1. En Supabase abra **SQL Editor → New query**, pegue todo `supabase/schema.sql` y pulse **Run**.
2. Supabase avisará de **operaciones destructivas**: son los `DROP` del inicio. Confirme con **Run this query**.

El script crea:

- Las **17 tablas**: las 13 del modelo del informe más `especialidad`, `horario_medico`, `pago` y `cita`, con sus
  restricciones y los catálogos de áreas, especialidades y CIE-10.
- El **horario semanal de demostración**:
  - Medicina General: Dra. Ríos de lunes a sábado de 07:00 a 13:00, y Dr. Paz de lunes a viernes de 13:00 a 19:00.
  - Pediatría: lunes, miércoles y viernes.
  - Cardiología: solo martes y jueves.
- Las **cuentas de demostración en Supabase Auth**, con contraseña `SgcDemo2026`:

  | Usuario | Rol |
  |---|---|
  | `a.admision` | Admisión (registro, citas y llegada de citados) |
  | `c.caja` | Caja |
  | `e.triaje` | Enfermería |
  | `m.consulta` | Médico · Medicina General |
  | `m.consulta2` | Médico · Medicina General |
  | `m.pediatria` | Médico · Pediatría |
  | `m.cardio` | Médico · Cardiología |
  | `j.jefatura` | Jefatura |
  | `e.turno2` | Enfermería (inactiva) |

- Los **umbrales clínicos iniciales**.
- Las **políticas de seguridad por rol (RLS)** y las funciones que usa la app.

Ejecutarlo otra vez **borra todos los datos** y restablece esas contraseñas.

**Actualizar un proyecto ya instalado sin borrar datos.** Para pasar a la versión 1.2, ejecute solo
`supabase/actualizacion-v1.2.sql` en el SQL Editor. Hace dos cambios:
- agrega la espera aproximada a la pantalla de sala;
- permite que Enfermería dé la cita al terminar el triaje;
- agrega la cita por web o por teléfono (`sgc_paciente_cita`, `sgc_cupos` y `sgc_reservar_cita`), con el usuario de
  sistema `a.citasweb` (inactivo y sin cuenta de acceso), que figura como autor de las reservas web;
- la pantalla de sala muestra también a los citados de hoy que sacaron su cita días antes.

> Si aparece un error de permisos sobre `auth.users`, Supabase no dejó crear las cuentas desde SQL.
> Copie el mensaje exacto: la alternativa es crear las cuentas con una Edge Function.

**Todo en un solo paso.** `supabase/actualizacion-unica.sql` reúne, en orden, el arreglo de Caja, la versión 1.3 y
los datos de demostración ampliados. En un proyecto que ya tiene la versión 1.2 basta con ejecutar ese archivo
(se puede repetir). Los archivos de abajo son sus partes, por si se quiere ejecutar solo una.

**Versión 1.3: cartera completa de primer nivel.** Ejecute `supabase/actualizacion-v1.3.sql` **antes** de publicar la
versión de la app que la usa. Solo agrega filas (no cambia tablas, el modelo de ERwin sigue igual) y se puede repetir:
- 7 especialidades más (Medicina Familiar e Interna, CRED, Obstetricia, Odontología, Psicología y Nutrición), con
  los consultorios 5 a 8 y 12 diagnósticos CIE-10 de primer nivel;
- 8 profesionales con horario (contraseña `SgcDemo2026`): `m.familiar`, `m.interna`, `m.obstetra`, `m.cred`,
  `m.odonto`, `m.odonto2`, `m.psicologia` y `m.nutricion`. Usan el espacio de Consulta (prefijo `m.`) con la
  colegiatura de su colegio: CMP, CEP, COP, CPsP o CNP.

Si «Restablecer datos demo» se usa sin esta actualización, falla: la historia de demostración tiene citas con estos
profesionales.

**Datos de demostración ampliados (opcional).** `supabase/datos-demo.sql` agrega, sin borrar nada y sin duplicar
si se ejecuta otra vez:
- 11 cuentas más (contraseña `SgcDemo2026`): `a.admision4`, `a.admision5`, `c.caja4`, `e.triaje4`, `e.triaje5`,
  `j.direccion` y los médicos `m.general5`, `m.general6` (Medicina General), `m.pediatria3` (Pediatría),
  `m.cardio2` (Cardiología) y `m.gineco2` (Ginecología), con horario en los turnos libres de los consultorios;
- 18 pacientes (DNI 46000101 a 46000118) por tipo de caso: niños, adolescente, gestante, adultos mayores, alérgicos,
  crónicos (hipertensión, diabetes, EPOC), no asegurados, SIS pendiente de validación y un paciente frecuente, con
  26 atenciones anteriores completas (pago, triaje, cita, consulta, diagnóstico y receta) en todas las ramas. Las 7 de
  los servicios nuevos requieren la versión 1.3; sin ella se omiten con un aviso.

Para probar un paciente nuevo use un DNI que no exista, por ejemplo del 46000201 al 46000299. **Restablecer datos
demo** borra los pacientes (no el personal ni los horarios): después vuelva a ejecutar este archivo.

## 3. Configurar Supabase Auth

En **Authentication → Sign In / Providers**, desactive **Allow new users to sign up**.

Solo Jefatura crea cuentas desde la app. Aun con el registro abierto, una cuenta creada por otra vía no tendría
acceso, porque el rol se toma de `app_metadata`, que solo el servidor puede escribir. Desactivarlo evita cuentas basura.

## 4. Claves para Vercel

En **Project Settings → API Keys**:

- `VITE_SUPABASE_URL` = `https://<id>.supabase.co`, sin `/rest/v1`.
- `VITE_SUPABASE_ANON_KEY` = la *publishable key*, que empieza con `sb_publishable_`.

Nunca use la *secret key* en la app.

## 5. Publicar en Vercel

Importe el repositorio, agregue las dos variables del paso 4 y despliegue. Vercel detecta Vite solo.

`vercel.json` agrega las cabeceras de seguridad del sitio: CSP, HSTS, X-Frame-Options, Referrer-Policy y
Permissions-Policy.

Si cambia las variables, use **Deployments → ⋯ → Redeploy**.

## 6. Primer uso

1. Ingrese como `j.jefatura` y pulse **Restablecer datos demo**. Se cargan unas cinco semanas de atenciones de
   demostración, con unos 600 turnos y 370 pacientes ficticios. La carga va en varias peticiones pequeñas y tarda
   unos segundos. Sin este paso, el tablero gerencial queda vacío.
2. Cambie las contraseñas de demostración desde **Cambiar contraseña** antes de mostrar el sistema.

## 7. Verificación en el sitio publicado

- [ ] `a.admision`: registra un paciente nuevo sin seguro (por ejemplo, DNI `70000027`). El turno queda pendiente de pago.
- [ ] `c.caja`: cobra el turno en efectivo y emite la boleta. El turno pasa a la lista de triaje.
- [ ] `e.triaje`: llama al turno, inicia el triaje, registra los signos y pulsa «Finalizar triaje y dar cita». Aparece
      la prioridad y la cita que propone el sistema; al confirmarla se imprime la constancia. El paciente no vuelve a
      Admisión.
- [ ] `a.admision`, **Citas**: con el motivo «Control de presión arterial» el sistema sugiere Cardiología. Si hoy no
      es martes ni jueves, propone el primer cupo de otro día y el turno queda citado.
- [ ] `a.admision`, **Citas de hoy**: registra la llegada de un citado de hoy.
- [ ] El médico de la cita (`m.consulta` o `m.cardio`) solo ve a sus pacientes: llama, atiende, registra el CIE-10 y
      la receta, y finaliza.
- [ ] `j.jefatura`, **Horarios médicos**: agrega un bloque y comprueba que el sistema rechaza un cruce de consultorio.
- [ ] Sin sesión, `…/#/cita`:
      - con un DNI y una fecha de nacimiento equivocada aparece el aviso;
      - con los datos correctos se reserva una cita de Cardiología, que solo ofrece martes y jueves;
      - al intentar otra cita, el sistema muestra la que ya tiene.
- [ ] `a.admision`, **Agenda de citas**: la cita figura con «Reservó por web». Ese día, «Registrar llegada» la envía a
      Caja (o a triaje con SIS) y entrega el ticket. Tras el triaje pasa directo a su médico.
- [ ] En otro equipo o en el celular, `…/#/sala` muestra los llamados al instante y la espera aproximada de cada
      turno en cola. No muestra nombres ni DNI.
- [ ] `j.jefatura`, **Tablero gerencial**: el panel «Afluencia prevista» muestra los próximos días y su precisión.
- [ ] Con la sesión de `a.admision`, escribir `…/#/jefatura` en la barra devuelve al espacio de Admisión.
- [ ] `j.jefatura`: crea un usuario. La contraseña temporal se muestra una vez y el usuario debe cambiarla al ingresar.
- [ ] `j.jefatura`, **Tablero gerencial**: cambie el periodo (Hoy, 7 días, 14 días, 4 semanas) y exporte el CSV.
- [ ] `m.consulta`, **Historias clínicas**: busque `70000001` y revise las atenciones anteriores.
- [ ] En Supabase, **Advisors → Security Advisor**: revise las advertencias.
      Las funciones `SECURITY DEFINER` son intencionales: son la única vía de escritura.

## Seguridad implementada

| Capa | Medida |
|---|---|
| Transporte | HTTPS obligatorio (Vercel + Supabase), HSTS |
| Navegador | CSP estricta (scripts, estilos y fuentes solo del propio sitio), sin iframes (clickjacking), sin acceso a cámara, micrófono ni ubicación |
| Autenticación | Supabase Auth, contraseñas bcrypt (costo 10), JWT con expiración |
| Sesión | En `sessionStorage` (se pierde al cerrar la pestaña), cierre tras 15 min sin actividad, bloqueo tras 3 intentos |
| Contraseñas | Mínimo 8 caracteres con letras y números; clave temporal aleatoria y de un solo uso. Mientras no se cambie, la base no entrega ningún dato a esa cuenta; `sgc_clave_cambiada()` comprueba que el hash ya no es el temporal antes de liberar el acceso |
| Autorización | Rol leído de `usuario` vía `app_metadata`; un usuario desactivado pierde el acceso aunque tenga un JWT válido |
| Lectura (RLS) | Admisión: pacientes y turnos. Enfermería: + signos vitales. Médico: + atenciones y recetas. Jefatura: turnos, usuarios y auditoría, **sin** datos personales ni clínicos |
| Historia clínica | `sgc_historia()` solo para Enfermería (signos) y Medicina (todo); la base audita cada lectura |
| Indicadores | `sgc_indicadores()` solo para Jefatura: un hecho anónimo por turno, sin código de turno, con la llegada redondeada a la hora y la duración de cada etapa (además prioridad, sexo, edad, SIS, CIE-10 y destino); máximo 93 días |
| Carga de demostración | Solo Jefatura; las partes siguientes exigen el token de la carga recién abierta (10 min), así no sirve para insertar historia en datos reales |
| Escritura | Solo `sgc_guardar()`: valida rol, máquina de estados y datos en una transacción |
| Integridad | La base recalcula la prioridad de triaje; rechaza códigos duplicados, consultorios ocupados y turnos activos duplicados |
| Pago y citas | La tarifa la fija la base; sin pago (o SIS) no hay triaje. La cita se valida contra el horario del médico, el cupo libre (índice único `uq_cita_cupo`) y la prioridad: un crítico solo con sobrecupo hoy. Cada médico solo llama a los pacientes que tienen cita con él |
| Auditoría | Autor, fecha e IP los fija el servidor; no se pueden falsificar desde el navegador |
| Datos públicos | La pantalla de sala usa `sgc_sala()`: solo código, estado, destino y hora del llamado, ya ordenados (sin prioridad) |
| Secretos | La *publishable key* es pública por diseño; `.env` no se sube; `password_hash` no es legible desde la app |

## Limitaciones conocidas

1. **Datos ficticios únicamente.** Para usar datos reales hacen falta un análisis formal de la Ley N.º 29733:
   los datos se alojan en São Paulo, lo que es transferencia internacional. También hacen falta pruebas de
   penetración y copias de seguridad automáticas (plan de pago).
2. **Validación SIS simulada.** No hay integración con el servicio real del SIS.
3. **Plan gratuito.** Supabase pausa el proyecto tras 7 días sin uso. Ábralo el día anterior a cada revisión.
4. **Diferencias con el modelo físico del informe:**
   - Se agregan `especialidad`, `horario_medico`, `pago` y `cita`, y `usuario.id_especialidad` (el diagrama para
     ERwin está en `erwin/sgc_modelo_erwin.sql`).
   - `turno` agrega `ts_ultimo_llamado`, `veces_llamado` e `id_usuario_en_atencion`, y los estados `PENDIENTE_PAGO`,
     `PENDIENTE_CITA` y `CITADO`.
   - El código de turno se reinicia cada día (`TR-001`…), como indica la restricción única `(fecha_turno, codigo_turno)`.
   - `auditoria.operacion` admite `LOGOUT`.
   - `detalle_receta.cantidad_solicitada` es opcional.
   - `usuario.password_hash` guarda la referencia a la credencial de Supabase Auth; el hash bcrypt vive en `auth.users`.
5. **Indicadores anónimos, no anonimizados con garantía formal.** Los hechos del tablero no traen nombre ni DNI.
   Aun así, en un establecimiento pequeño, la combinación de fecha, edad, sexo y diagnóstico podría identificar a
   alguien. Con datos reales conviene agregar en la base o aplicar un umbral mínimo de casos por celda.
6. **El modo local no aplica RLS.** Sin Supabase, todos los roles leen la misma copia del navegador. Sirve solo
   para desarrollar; la separación de datos por rol se comprueba en el modo Supabase.
7. **Umbrales de triaje sin ajuste por edad.** Usan valores de adulto. En niños, la frecuencia cardiaca y la
   respiratoria normales son más altas, y el responsable clínico debería definir umbrales pediátricos.
