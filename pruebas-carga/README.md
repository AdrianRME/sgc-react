# Pruebas de carga (k6)

Scripts para medir el sistema con peticiones masivas y datos ficticios. No usan datos de pacientes reales.

| Script | Qué prueba |
|---|---|
| `jornada.js` | Una jornada con 10 estaciones a la vez (RNF-02): Admisión, Caja, Triaje, dos consultorios, Jefatura, dos pantallas de sala y dos estaciones de consulta en modo lectura. Cada estación sigue las reglas de `src/store/actions.js` y recarga `sgc_cargar()` después de cada acción. |
| `concurrencia.js` | Choques entre estaciones (RNF-09): doble cobro del mismo turno, el mismo código de turno desde dos admisiones y dos pacientes a la vez en el único módulo de triaje. Por cada caso, uno se guarda y el otro se rechaza. |
| `estres.js` | De 10 a 30 usuarios virtuales en escalones de 5, para ver desde cuándo el percentil 95 supera 1,5 s (RNF-01). |
| `verificar.sql` | Controles de integridad y tiempos por etapa en la base después de la prueba. |

## Entorno usado (23 de octubre de 2026)

La prueba no se ejecuta contra el proyecto de Supabase publicado, para no llenar la demostración con datos de prueba. Se
usó una réplica local con los mismos componentes que Supabase usa para la API de datos:

- PostgreSQL 18.6 con `supabase/schema.sql` sin cambios, más lo mínimo que trae un proyecto de Supabase
  (roles `anon`, `authenticated` y `authenticator`, esquema `auth`, `auth.uid()` y `auth.jwt()`).
- PostgREST 12.2.3 (la capa que expone `/rest/v1/rpc/...` en Supabase), con un token JWT por cuenta de demostración.
- k6 0.54.0.

Condición de la prueba: como se ejecutó de madrugada, en la réplica se quitó el límite de 06:00 a 22:00 de
`horario_medico` para abrir un bloque de 00:00 a 07:00. La réplica no mide la latencia de internet ni el inicio de
sesión de Supabase Auth.

## Cómo repetirla contra un proyecto de prueba de Supabase

1. Cree un proyecto de Supabase aparte (no el publicado) y ejecute `supabase/schema.sql`.
2. Obtenga un token de acceso por cuenta (inicio de sesión con la contraseña de demostración) y guárdelos en
   `tokens.json` como `{ "a.admision": "<token>", ..., "anon": "<clave publicable>" }`.
3. Ejecute, por ejemplo:

```
k6 run -e API=https://<proyecto>.supabase.co/rest/v1 -e TOKENS=tokens.json -e PACIENTES=60 jornada.js
```

Con Supabase, agregue el encabezado `apikey` con la clave publicable en la función `rpc` de cada script.
