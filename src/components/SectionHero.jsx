import { Icon3D } from './Icon3D.jsx';
import { AnimatedNumber } from './ui.jsx';

const entero = (x) => String(Math.round(x));
// Trazo de ECG decorativo del encabezado (la identidad de monitor del sistema)
const TRAZO = Array.from({ length: 5 }, () => 'l60 0 q6 -8 12 0 l8 0 l4 6 l6 -32 l6 40 l4 -14 l10 0 q8 -12 16 0').join(' ');

/**
 * Encabezado de color de una sección: ícono, título y unas tarjetas con cifras. Cada tarjeta lleva el color de
 * su estación (`c`). Con `onPick`, las tarjetas son filtros: la elegida queda marcada (`active`); las que llevan
 * `pick: false` solo informan. `format` cambia cómo se escribe la cifra (por omisión, un entero).
 * tiles: [{ k, n, icon, c, value, format?, pick? }]
 */
export function SectionHero({ icon, kicker, title, text, tiles = [], active, onPick, label = 'Resumen', actions }) {
  return (
    <section className="hero">
      {/* Las capas decorativas van recortadas aparte, para que la ayuda y los menús del encabezado no se corten */}
      <div className="hero-bg" aria-hidden="true">
        <svg className="hero-ecg" viewBox="0 0 600 60" preserveAspectRatio="none">
          <path d={`M0 40 ${TRAZO}`} />
        </svg>
      </div>
      <div className="hero-t">
        <Icon3D name={icon} size={64} />
        <div>
          {kicker && <small>{kicker}</small>}
          <h1>{title}</h1>
          {text && <p>{text}</p>}
        </div>
        {actions && <div className="hero-acts">{actions}</div>}
      </div>
      {tiles.length > 0 && (
        <div className="hero-kpis" style={{ '--n': tiles.length }} role="group" aria-label={label}>
          {tiles.map((t) => {
            const body = (
              <>
                <Icon3D name={t.icon} size={30} />
                <b><AnimatedNumber value={t.value} format={t.format ?? entero} /></b>
                <span className="hero-kpi-l">{t.n}</span>
              </>
            );
            return onPick && t.pick !== false ? (
              <button key={t.k} type="button" className="hero-kpi" data-role={t.c} aria-pressed={active === t.k} onClick={() => onPick(t.k)}>{body}</button>
            ) : (
              <div key={t.k} className="hero-kpi" data-role={t.c}>{body}</div>
            );
          })}
        </div>
      )}
    </section>
  );
}
