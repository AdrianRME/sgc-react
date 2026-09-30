import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/StoreProvider.jsx';
import { byArrival, byPriority } from '../lib/clinical.js';
import { fmtT } from '../lib/format.js';
import { beep, announce } from '../lib/sound.js';
import { useNow } from '../hooks/useNow.js';

/**
 * Pantalla para el televisor de la sala de espera.
 * Por privacidad solo muestra el código del turno y el destino, nunca nombres.
 */
export function Sala({ standalone = false }) {
  const { db } = useStore();
  const now = useNow(15_000);
  // El navegador solo permite audio después de una interacción del usuario.
  const [sound, setSound] = useState(false);
  const [voice, setVoice] = useState(true);
  const seen = useRef(null);
  const [flashKey, setFlashKey] = useState('');

  const calls = db.turns
    .filter((t) => ['LLAMADO_TRIAJE', 'LLAMADO_CONSULTA'].includes(t.state))
    .sort((a, b) => (b.calledAt || 0) - (a.calledAt || 0));
  const cur = calls[0];
  const waiting = [
    ...db.turns.filter((t) => t.state === 'EN_ESPERA_CONSULTA').sort(byPriority),
    ...db.turns.filter((t) => t.state === 'EN_ESPERA_TRIAJE').sort(byArrival),
  ];

  const key = cur ? `${cur.id}@${cur.calledAt}` : '';
  useEffect(() => {
    if (seen.current === null) {
      seen.current = key; // primera carga: no anunciar llamados antiguos
      return;
    }
    if (key && key !== seen.current) {
      seen.current = key;
      setFlashKey(key);
      if (sound) {
        beep();
        if (voice) setTimeout(() => announce(cur.id, cur.dest), 700);
      }
    }
  }, [key, sound, voice, cur]);

  return (
    <div className={`sala ${standalone ? 'full' : ''}`}>
      <div className="mainp">
        <div className="l">
          <h3>Llamando ahora</h3>
          {cur ? (
            <div className={`big ${flashKey === key ? 'flash' : ''}`} key={key} aria-live="assertive">
              <div className="n">{cur.id}</div>
              <div className="go">
                <small>Pase a</small>
                <b>{cur.dest}</b>
              </div>
            </div>
          ) : (
            <div className="none">Sin llamados en este momento</div>
          )}
          {calls.length > 1 && (
            <div>
              <h3>También llamados</h3>
              <div className="others">
                {calls.slice(1, 5).map((t) => (
                  <div key={t.id}><span className="code">{t.id}</span> → {t.dest}</div>
                ))}
              </div>
            </div>
          )}
          <div className="sala-ctl">
            <button className="sbtn" onClick={() => { setSound((s) => !s); if (!sound) beep(); }} aria-pressed={sound}>
              {sound ? '🔔 Sonido activado' : '🔕 Activar sonido'}
            </button>
            {sound && (
              <button className="sbtn" onClick={() => setVoice((v) => !v)} aria-pressed={voice}>
                {voice ? 'Voz: sí' : 'Voz: no'}
              </button>
            )}
            {standalone && (
              <button className="sbtn" onClick={() => document.documentElement.requestFullscreen?.()}>Pantalla completa</button>
            )}
          </div>
        </div>
        <div className="r">
          <h3>Próximos turnos</h3>
          <div className="wl">
            {waiting.length ? waiting.slice(0, 8).map((t) => (
              <div key={t.id}>
                <span className="code">{t.id}</span>
                <span>{t.state === 'EN_ESPERA_TRIAJE' ? 'Triaje' : 'Consulta'}</span>
              </div>
            )) : <div className="none sm">Sin turnos en espera</div>}
          </div>
        </div>
      </div>
      <div className="foot">
        <span>Centro de Salud (demo)</span>
        <span className="m">Por favor, permanezca atento a la pantalla</span>
        <span>{fmtT(now)}</span>
      </div>
    </div>
  );
}
