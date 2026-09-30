# SGC · Sistema de Gestión Clínica (PMV)

Prototipo del flujo de atención de un centro de salud:
**Admisión → Triaje → Consulta médica → Receta**, con pantalla de sala de espera y módulo de Jefatura
(indicadores, usuarios, auditoría y umbrales clínicos).

Hecho con **React 19 + Vite** y con **Supabase** (PostgreSQL + tiempo real) como base de datos opcional.

## Cómo ejecutarlo

```bash
npm install
npm run dev        # abre http://localhost:5173
npm test           # pruebas de la lógica clínica y del flujo completo
npm run build      # versión de producción en /dist
```

Usuarios de demostración (contraseña `demo1234`): `a.admision`, `e.triaje`, `m.consulta`, `m.consulta2`, `j.jefatura`.
La pantalla de login también tiene botones de acceso rápido.

La **pantalla de sala** está en `http://localhost:5173/#/sala`. Ábrala en otra ventana o en el monitor de la sala:
se actualiza sola cada vez que alguien llama a un paciente y puede anunciar el turno con sonido y voz.

## Datos: modo local o Supabase

Sin configuración, la app guarda todo en el **localStorage** del navegador. Los datos sobreviven al recargar
y se sincronizan entre pestañas del mismo navegador.

Para usar una **base de datos real y compartida entre varias PCs**:

1. Cree una cuenta gratuita en <https://supabase.com> y un proyecto nuevo.
2. En **SQL Editor → New query**, pegue el contenido de [`supabase/schema.sql`](supabase/schema.sql) y pulse **Run**.
3. En **Project Settings → API Keys**, copie la *Project URL* y la *publishable key* (`sb_publishable_...`).
4. Copie `.env.example` como `.env` y complete ambos valores.
5. Reinicie `npm run dev`. La barra superior mostrará «Supabase · tiempo real».
   En la primera carga, la base se llena con los datos de demostración.

> Las políticas de seguridad del esquema permiten leer y escribir con la clave pública, **solo para el prototipo**.
> Para producción se debe usar Supabase Auth con políticas por rol.

Para publicarla en internet (Vercel) siga [`DESPLIEGUE.md`](DESPLIEGUE.md).

## Estructura

```
src/
  lib/          lógica pura, sin React (se puede probar)
    clinical.js   prioridad de triaje, IMC, máquina de estados, alergias, validaciones
    constants.js  catálogos (roles, estados, CIE-10, medicamentos, umbrales)
    ids.js        correlativos (TR-, REC-, HC-) calculados desde los datos
    seed.js       datos de demostración
  store/
    actions.js        reglas de negocio: (datos, contexto) → cambios
    StoreProvider.jsx estado global (Context), sesión y avisos
  data/         repositorios: localRepo (localStorage) y supabaseRepo
  components/   UI reutilizable (Modal, ConfirmDialog, CiePicker, documentos…)
  views/        una vista por módulo: Admision, Triaje, Consulta, Sala, Jefatura, Login
supabase/schema.sql  tablas, restricciones, políticas y publicación de tiempo real
```

**Decisión de diseño:** las reglas de negocio son funciones puras que devuelven los cambios a guardar.
La interfaz solo las invoca, y el repositorio (local o Supabase) persiste el resultado.
Así la lógica se prueba sin navegador y cambiar de base de datos no toca la interfaz.

## Reglas implementadas

- **Estados del turno** con transiciones válidas: no se puede, por ejemplo, pasar de «en espera de triaje» a «en consulta».
- **Un paciente por puesto:** un solo triaje activo, y una consulta activa por consultorio.
- **Un turno activo por paciente**, verificado en admisión.
- **Prioridad** CRÍTICA / PRIORITARIA / NORMAL según umbrales versionados y aprobados por un médico,
  con validación de coherencia entre los umbrales de alerta y los críticos.
- **Tiempo objetivo de espera** por prioridad: se resalta cuando se supera.
- **Cruce receta-alergia** (p. ej. penicilina → amoxicilina, AINE → ibuprofeno). Exige una confirmación explícita,
  que queda auditada.
- **Receta firmada por el médico** que atendió, con su colegiatura.
- **Auditoría** de inicio de sesión, búsquedas, llamados, accesos a historia clínica y cambios de usuarios y umbrales.
- **Login** con bloqueo temporal tras 3 intentos fallidos. El rol se toma del usuario (RBAC), no se elige.
