# Despliegue: Supabase + Vercel

Guía para publicar el sistema con la base de datos y la autenticación en Supabase y la aplicación en Vercel.

**Cómo se probó.** `npm test` pasa las 33 pruebas, `npm run lint` no da advertencias y `npm run build` compila sin
errores. `supabase/schema.sql` se ejecutó en PostgreSQL 16 con el esquema real de Supabase Auth (migraciones del
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

- Las **13 tablas del modelo del informe**, con sus restricciones y los catálogos de áreas y CIE-10.
- Las **cuentas de demostración en Supabase Auth**, con contraseña `SgcDemo2026`:

  | Usuario | Rol |
  |---|---|
  | `a.admision` | Admisión |
  | `e.triaje` | Enfermería |
  | `m.consulta` | Médico |
  | `m.consulta2` | Médico |
  | `j.jefatura` | Jefatura |
  | `e.turno2` | Enfermería (inactiva) |

- Los **umbrales clínicos iniciales**.
- Las **políticas de seguridad por rol (RLS)** y las funciones que usa la app.

Ejecutarlo otra vez **borra todos los datos** y restablece esas contraseñas.

> Si aparece un error de permisos sobre `auth.users`, Supabase no dejó crear las cuentas desde SQL.
> Copie el mensaje exacto: la alternativa es crear las cuentas con una Edge Function.

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

- [ ] `a.admision`: registra un paciente nuevo y genera su turno.
- [ ] `e.triaje`: llama al turno, inicia el triaje, registra los signos y guarda. Aparece la prioridad.
- [ ] `m.consulta`: llama, inicia la atención, registra el CIE-10 y la receta, y finaliza.
- [ ] En otro equipo o en el celular, `…/#/sala` muestra los llamados al instante. No muestra nombres ni DNI.
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
   - `turno` agrega `ts_ultimo_llamado`, `veces_llamado` e `id_usuario_en_atencion`.
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
