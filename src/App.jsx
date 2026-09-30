import { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './store/StoreProvider.jsx';
import { ROLES } from './lib/constants.js';
import { Shell } from './components/Shell.jsx';
import { Toasts } from './components/Toasts.jsx';
import { Login } from './views/Login.jsx';
import { Admision } from './views/Admision.jsx';
import { Triaje } from './views/Triaje.jsx';
import { Consulta } from './views/Consulta.jsx';
import { Jefatura } from './views/Jefatura.jsx';
import { Sala } from './views/Sala.jsx';

const VIEWS = { adm: Admision, enf: Triaje, med: Consulta, jef: Jefatura, sala: () => <Sala /> };

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const h = () => setHash(window.location.hash);
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return hash;
}

function Router() {
  const { db, status, user, session } = useStore();
  const hash = useHash();

  if (!db) {
    return (
      <div className="login">
        <div className="card center">
          {status.ok ? (
            <p>Cargando datos…</p>
          ) : (
            <>
              <h2>No se pudo conectar con la base de datos</h2>
              <p className="note">{status.msg}</p>
              <p className="note">Revise VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el archivo .env, y que haya ejecutado supabase/schema.sql.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  // Pantalla pública para el televisor de la sala (no requiere sesión).
  if (hash === '#/sala') return <Sala standalone />;
  if (!user) return <Login />;

  const allowed = [...ROLES[user.role].mods, 'sala'];
  const view = allowed.includes(session.view) ? session.view : allowed[0];
  const View = VIEWS[view];
  return (
    <Shell view={view}>
      <View />
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
