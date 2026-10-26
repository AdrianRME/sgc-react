import { Icon3D } from './Icon3D.jsx';
import { AnimatedNumber } from './ui.jsx';

const entero = (x) => String(Math.round(x));

/**
 * Encabezado de color de una sección: ícono, título y unas tarjetas con cifras. Cada tarjeta lleva el color de
 * su estación (`c`). Con `onPick`, las tarjetas son filtros: la elegida queda marcada (`active`).
 * tiles: [{ k, n, icon, c, value }]
 */
export function SectionHero({ icon, kicker, title, text, tiles = [], active, onPick, label = 'Resumen', actions }) {
  return (
    <section className="hero">
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
                <b><AnimatedNumber value={t.value} format={entero} /></b>
                <span className="hero-kpi-l">{t.n}</span>
              </>
            );
            return onPick ? (
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
