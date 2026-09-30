# Despliegue: Supabase + Vercel

Guía para publicar el PMV con la base de datos en Supabase y la aplicación en Vercel.
Probado localmente: `npm test` (15 pruebas) y `npm run build` sin errores. `supabase/schema.sql` se ejecutó
en PostgreSQL 16 con los roles de Supabase simulados, y el flujo completo de la app (admisión → triaje →
consulta → receta, umbrales, usuarios, auditoría) se guardó y se leyó sin pérdida con el rol `anon`.

## 1. Subir el código a GitHub

```bash
cd sgc-react
git init
git add .
git commit -m "PMV del sistema de gestión clínica"
git branch -M main
git remote add origin https://github.com/<su-usuario>/sgc-react.git
git push -u origin main
```

`.gitignore` ya excluye `node_modules`, `dist` y `.env` (las credenciales no se suben).

## 2. Crear el proyecto en Supabase

1. <https://supabase.com> → **New project**.
2. Región: **South America (São Paulo)**, la más cercana a Lima.
3. Guarde la contraseña de la base de datos en un lugar seguro.

## 3. Crear las tablas

**SQL Editor → New query**, pegue todo `supabase/schema.sql` y pulse **Run**.

- Crea las **13 tablas del modelo del informe** (paciente, usuario, area_atencion, historia_clinica, turno,
  signos_vitales, atencion_medica, diagnostico_cie10, atencion_diagnostico, receta_medica, detalle_receta,
  umbral_clinico, auditoria), los catálogos de áreas y CIE-10 y las funciones que usa la app.
- Supabase avisará de **operaciones destructivas**: son los `DROP` del inicio, que borran las tablas de la
  versión anterior del prototipo. Confirme con **Run this query**.
- Ejecutarlo otra vez **borra todos los datos** y reinstala el esquema. La app vuelve a cargar los datos
  de demostración al abrirse.

Compruebe en **Database → Publications → supabase_realtime** que aparecen 6 tablas
(usuario, paciente, historia_clinica, turno, umbral_clinico, auditoria).

## 4. Copiar la URL y la clave pública

**Project Settings → API Keys** (o el botón **Connect**):

- **Project URL**: `https://<id>.supabase.co`
- **Publishable key**: empieza con `sb_publishable_...` (sirve igual que la antigua clave *anon*).

Nunca use la *secret key* ni la *service_role* en la aplicación.

## 5. Probar en su computadora

Copie `.env.example` como `.env`:

```
VITE_SUPABASE_URL=https://<id>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

```bash
npm install
npm run dev
```

La barra superior debe decir **«Supabase · tiempo real»**. La primera carga llena la base con los datos
de demostración. Abra `http://localhost:5173/#/sala` en otra ventana y llame un turno para comprobar
el tiempo real.

## 6. Publicar en Vercel

1. <https://vercel.com> → **Add New → Project** → importe el repositorio `sgc-react`.
2. Vercel detecta **Vite**: build `npm run build`, salida `dist`. No cambie nada.
3. En **Environment Variables** agregue `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` con los mismos valores del `.env`.
4. **Deploy**. Obtendrá una dirección `https://sgc-react-<algo>.vercel.app`.

La app usa rutas con `#` (por ejemplo `/#/sala`), así que no hace falta `vercel.json`.
Si cambia las variables después, vuelva a desplegar: Vite las incorpora al compilar.

## 7. Verificar el sitio publicado

- Iniciar sesión con cada rol y recorrer admisión → triaje → consulta → receta.
- Abrir `https://<su-sitio>.vercel.app/#/sala` en otro equipo o en el celular y llamar un turno.
- En Supabase, **Table Editor → turno**, confirmar que el turno quedó guardado; tras el triaje, revisar
  **signos_vitales** (el IMC lo calcula la base), y tras la consulta **atencion_medica** y **receta_medica**.

## 8. Mantenimiento

- El plan gratuito de Supabase **pausa el proyecto tras 1 semana sin uso**. Ábralo el día anterior a cada revisión.
- Cada `git push` a `main` vuelve a publicar el sitio automáticamente.

## Cómo guarda la app

La app no escribe directamente en las tablas. Llama a tres funciones de la base:

- `sgc_cargar()` lee las 13 tablas y las devuelve en el formato de la app.
- `sgc_guardar(cambios)` guarda cada acción en **una sola transacción**. Además, rechaza cambios de estado
  inválidos (por ejemplo, dos consultorios que intentan atender al mismo paciente) y códigos de turno
  repetidos. Si falla una parte, no se guarda nada.
- `sgc_restablecer()` vacía los datos para el botón «Restablecer datos demo».

## Limitaciones conocidas de esta versión (no usar con pacientes reales)

1. **Lectura abierta:** con la clave pública solo se puede **leer** las tablas y usar esas tres funciones.
   No se puede insertar, modificar ni borrar filas directamente. Aun así, cualquiera que tenga la clave
   (viaja dentro del sitio) puede ver todos los datos y usar `sgc_restablecer`.
   Corrección prevista: Supabase Auth + políticas RLS por rol.
2. **Inicio de sesión de demostración:** una sola contraseña (`demo1234`) comprobada en el navegador.
   La tabla `usuario` guarda su hash bcrypt, pero todavía no se usa para validar.
3. **Pantalla de sala:** descarga todos los turnos aunque solo muestre código y destino.
4. **Diferencias con el modelo físico del informe:** `turno` agrega `ts_ultimo_llamado`, `veces_llamado`
   e `id_usuario_en_atencion`; `auditoria.operacion` admite `LOGOUT`; `detalle_receta.cantidad_solicitada`
   es opcional. El estado `LLAMANDO` se guarda igual que en el modelo; la app distingue si es llamado a
   triaje o a consulta según exista o no el registro de triaje.
