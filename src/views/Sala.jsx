import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, m } from 'motion/react';
import { Bell, BellOff, Maximize, Mic, MicOff, WifiOff } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { byArrival, byPriority } from '../lib/clinical.js';
import { TRIAGE_STATION } from '../lib/constants.js';
import { fmtLongDay, fmtT } from '../lib/format.js';
import { beep, announce } from '../lib/sound.js';
import { spring } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { BrandMark } from '../components/BrandMark.jsx';
import { Icon3D } from '../components/Icon3D.jsx';
import './sala.css';

/**
 * Turnos para la pantalla. Con sesión se usan los datos en tiempo real del personal; sin sesión
 * (televisor de la sala) se consulta cada 3 s la función pública sgc_sala(), que no entrega datos personales.
 */
function useSalaTurns() {
  const { db, repo } = useStore();
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState(false);
  const logged = !!db;
  useEffect(() => {
    if (logged) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const t = await repo.sala();
        if (alive) {
          setFeed(t);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [logged, repo]);
  // La función pública ya entrega los turnos ordenados (sin prioridad ni hora de llegada)
  return { turns: logged ? db.turns : feed || [], error: !logged && error, ordered: !logged };
}

const isTriage = (dest) => dest === TRIAGE_STATION;

/**
 * Pantalla del televisor de la sala de espera. Por privacidad solo muestra códigos de turno y destinos.
 * Cada llamado nuevo entra con una animación y, si se activó, con un tono y el anuncio por voz.
 */
export default function Sala({ standalone = false }) {
  const { turns, error, ordered } = useSalaTurns();
  const sortBy = (list, cmp) => (ordered ? list : [...list].sort(cmp));
  const now = useNow(15_000);
  // El navegador solo permite audio después de una interacción del usuario.
  const [sound, setSound] = useState(false);
  const [voice, setVoice] = useState(true);
  const seen = useRef(null);

  const calls = turns
    .filter((t) => ['LLAMADO_TRIAJE', 'LLAMADO_CONSULTA'].includes(t.state))
    .sort((a, b) => (b.calledAt || 0) - (a.calledAt || 0));
  const cur = calls[0];
  const nextMed = sortBy(turns.filter((t) => t.state === 'EN_ESPERA_CONSULTA'), byPriority);
  const nextTri = sortBy(turns.filter((t) => t.state === 'EN_ESPERA_TRIAJE'), byArrival);

  const key = cur ? `${cur.id}@${cur.calledAt}` : '';
  useEffect(() => {
    if (seen.current === null) {
      seen.current = key; // primera carga: no anunciar llamados antiguos
      return;
    }
    if (key && key !== seen.current) {
      seen.current = key;
      if (sound) {
        beep();
        if (voice) setTimeout(() => announce(cur.id, cur.dest), 700);
      }
    }
  }, [key, sound, voice, cur]);

  return (
    <div className={`sala ${standalone ? 'full' : ''}`}>
      <header className="sala-h">
        <BrandMark />
        <div><b>Centro de Salud</b><span>Sala de espera</span></div>
        <div className="clock"><b>{fmtT(now)}</b><span>{fmtLongDay(now)}</span></div>
      </header>

      <div className="sala-body">
        <section aria-live="assertive">
          <h2>Llamando ahora</h2>
          <AnimatePresence mode="popLayout">
            {cur ? (
              <m.div
                key={key}
                className={`call ${isTriage(cur.dest) ? 'tri' : 'med'}`}
                initial={{ opacity: 0, scale: 0.86, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 22 } }}
                exit={{ opacity: 0, y: -24, transition: { duration: 0.2 } }}
              >
                <span className="call-code">{cur.id}</span>
                <span className="call-to">
                  <Icon3D name={isTriage(cur.dest) ? 'thermometer' : 'stethoscope'} size={64} />
                  <span><small>Pase a</small><b>{cur.dest}</b></span>
                </span>
                <i className="ring" aria-hidden="true" />
              </m.div>
            ) : (
              <m.div key="none" className="call none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                Sin llamados en este momento
              </m.div>
            )}
          </AnimatePresence>
          {calls.length > 1 && (
            <div className="also">
              <h3>También llamados</h3>
              <LayoutGroup id="also">
                <ul>
                  {calls.slice(1, 5).map((t) => (
                    <m.li key={t.id} layout transition={spring} className={isTriage(t.dest) ? 'tri' : 'med'}>
                      <b>{t.id}</b><span>{t.dest}</span>
                    </m.li>
                  ))}
                </ul>
              </LayoutGroup>
            </div>
          )}
        </section>

        <section>
          <h2>Próximos turnos</h2>
          <div className="next-cols">
            {[['Consulta', nextMed, 'med'], ['Triaje', nextTri, 'tri']].map(([label, list, cls]) => (
              <div key={label} className={`next-col ${cls}`}>
                <h3>{label}<span>{list.length}</span></h3>
                <LayoutGroup id={`next-${cls}`}>
                  <ul>
                    <AnimatePresence initial={false}>
                      {list.slice(0, 7).map((t) => (
                        <m.li key={t.id} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={spring}>
                          {t.id}
                        </m.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </LayoutGroup>
                {!list.length && <p className="none-sm">Sin turnos en espera</p>}
                {list.length > 7 && <p className="none-sm">y {list.length - 7} más</p>}
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer className="sala-f">
        <span className={error ? 'err' : ''}>{error ? <><WifiOff aria-hidden="true" /> Sin conexión: reintentando…</> : 'Por favor, permanezca atento a la pantalla y a su código de turno.'}</span>
        <div className="sala-ctl">
          <button onClick={() => { setSound((s) => !s); if (!sound) beep(); }} aria-pressed={sound}>
            {sound ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}{sound ? 'Sonido activado' : 'Activar sonido'}
          </button>
          {sound && (
            <button onClick={() => setVoice((v) => !v)} aria-pressed={voice}>
              {voice ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}{voice ? 'Voz: sí' : 'Voz: no'}
            </button>
          )}
          {standalone && (
            <button onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}><Maximize aria-hidden="true" /> Pantalla completa</button>
          )}
        </div>
      </footer>
    </div>
  );
}
