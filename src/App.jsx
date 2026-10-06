import { lazy, Suspense, useEffect } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { StoreProvider } from './store/StoreProvider.jsx';
import { useStore } from './store/useStore.js';
import { ROLES } from './lib/constants.js';
import { page } from './lib/motion.js';
import { useHash } from './hooks/useHash.js';
import { Shell } from './components/Shell.jsx';
import { Toasts } from './components/Toasts.jsx';
import { ChangePassword } from './components/ChangePassword.jsx';
import { BrandMark } from './components/BrandMark.jsx';
import { Login } from './views/Login.jsx';

/* Cada sección se descarga recién cuando se abre: un rol nunca descarga el código de los demás. */
const Sala = lazy(() => import('./views/Sala.jsx'));
const Flujo = lazy(() => import('./views/Flujo.jsx'));
const VIEWS = {
  adm: { registro: lazy(() => import('./views/Admision.jsx')), flujo: Flujo },
  enf: { lista: lazy(() => import('./views/Triaje.jsx')) },
  med: { atencion: lazy(() => import('./views/Consulta.jsx')), historias: lazy(() => import('./views/Historias.jsx')) },
  jef: {
    tablero: lazy(() => import('./views/jefatura/Tablero.jsx')),
    flujo: Flujo,
    usuarios: lazy(() => import('./views/jefatura/Usuarios.jsx')),
    auditoria: lazy(() => import('./views/jefatura/Auditoria.jsx')),
    umbrales: lazy(() => import('./views/jefatura/Umbrales.jsx')),
  },
};

function Splash({ title, text, action }) {
  return (
    <div className="splash">
      <BrandMark className="brand-mark lg" />
      {title ? <h1>{title}</h1> : <p className="note">Cargando…</p>}
      {text && <p className="note">{text}</p>}
      {action}
    </div>
  );
}

const ViewLoading = () => (
  <div className="view" aria-busy="true">
    <div className="skeleton" style={{ height: 56, maxWidth: 520 }} />
    <div className="skeleton" style={{ height: 120 }} />
    <div className="skeleton" style={{ height: 320 }} />
  </div>
);

function Router() {
  const { db, status, auth, user, signOut, toast } = useStore();
  const { hash, route, sub } = useHash();
  const role = user ? ROLES[user.role] : null;
  const section = role && (sub === 'sala' || role.sections.some(([k]) => k === sub)) ? sub : null;

  // Cada rol trabaja solo en su espacio: otra dirección lo devuelve al suyo.
  useEffect(() => {
    if (!role || hash === '#/sala' || (route === role.slug && section)) return;
    if (route !== role.slug && Object.values(ROLES).some((r) => r.slug === route)) {
      toast('info', `Acceso restringido: su espacio es ${role.space}.`);
    }
    window.location.replace(`#/${role.slug}/${role.sections[0][0]}`);
  }, [role, route, section, hash, toast]);

  // Pantalla pública para el televisor de la sala (no requiere sesión ni muestra datos personales).
  if (hash === '#/sala') return <Suspense fallback={<Splash />}><Sala standalone /></Suspense>;
  if (auth === undefined) return <Splash />;
  if (!auth) return <Login />;
  // Con contraseña temporal no se carga ningún dato: primero hay que definir una propia
  if (auth.mustChange) {
    return (
      <>
        <Splash title="Contraseña temporal" text="Defina una contraseña personal para entrar a su espacio." />
        <ChangePassword forced />
      </>
    );
  }
  if (!db) {
    return status.ok ? <Splash /> : (
      <Splash
        title="No se pudo cargar la información"
        text={status.msg}
        action={<button className="btn" onClick={() => signOut()}>Volver a iniciar sesión</button>}
      />
    );
  }
  if (!user) {
    return (
      <Splash
        title="Usuario no habilitado"
        text="Su usuario está desactivado o no tiene un rol asignado. Contacte a Jefatura."
        action={<button className="btn" onClick={() => signOut()}>Salir</button>}
      />
    );
  }

  const current = section || role.sections[0][0];
  const View = current === 'sala' ? Sala : VIEWS[user.role][current];
  return (
    <Shell section={current}>
      <AnimatePresence mode="wait" initial={false}>
        <m.div key={current} {...page} className="view">
          <Suspense fallback={<ViewLoading />}>
            <View />
          </Suspense>
        </m.div>
      </AnimatePresence>
    </Shell>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Router />
      <Toasts />
    </StoreProvider>
  );
}
