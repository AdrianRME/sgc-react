# Despliegue: Supabase + Vercel

Guía para publicar el PMV con la base de datos en Supabase y la aplicación en Vercel.
Probado localmente: `npm test` (15 pruebas) y `npm run build` sin errores; `supabase/schema.sql`
se ejecutó dos veces seguidas sin errores en PostgreSQL con los roles de Supabase simulados.

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

El archivo incluye los `GRANT` que Supabase exige desde el 30 de mayo de 2026 para que las tablas
se puedan usar desde la aplicación. Sin ellos aparece el error *permission denied for table*.

Compruebe en **Database → Publications → supabase_realtime** que aparecen las 5 tablas.

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
- En Supabase, **Table Editor → turns**, confirmar que el turno quedó guardado.

## 8. Mantenimiento

- El plan gratuito de Supabase **pausa el proyecto tras 1 semana sin uso**. Ábralo el día anterior a cada revisión.
- Cada `git push` a `main` vuelve a publicar el sitio automáticamente.

## Limitaciones conocidas de esta versión (no usar con pacientes reales)

1. **Seguridad abierta:** las políticas `demo_all` permiten que cualquiera con la clave pública lea, modifique
   o borre datos. La clave pública viaja dentro de la aplicación, así que cualquiera que abra el sitio puede
   hacerlo, incluido el botón «Restablecer datos demo». Corrección prevista: Supabase Auth + políticas RLS por rol.
2. **Inicio de sesión de demostración:** una sola contraseña (`demo1234`) comprobada en el navegador.
3. **Pantalla de sala:** descarga todos los turnos aunque solo muestre código y destino.
4. **Correlativos:** el código de turno se calcula en el navegador; dos admisiones registrando al mismo tiempo
   podrían generar el mismo código y la segunda sobrescribiría a la primera.
5. **Modelo de datos:** estas 5 tablas (con detalle en `jsonb`) son una versión simplificada del modelo de
   13 entidades del informe.
