import { Icono } from './Icono.jsx';
import { AnimatedNumber } from './ui.jsx';

const entero = (x) => String(Math.round(x));

/**
 * Encabezado de una sección: la cabecera de una hoja del expediente. Rótulo del área, título, texto de apoyo y
 * una fila de casillas con cifras. Cada casilla lleva el color de su estación (`c`). Con `onPick`, las casillas
 * son filtros: la elegida queda marcada (`active`); las que llevan `pick: false` solo informan.
 * `format` cambia cómo se escribe la cifra (por omisión, un entero).
 * tiles: [{ k, n, icon, c, value, format?, pick? }]
 */
export function SectionHero({ icon, kicker, title, text, tiles = [], active, onPick, label = 'Resumen', actions }) {
  return (
    <section className="hero">
      {/* La trama de la hoja va recortada aparte, para que la ayuda y los menús del encabezado no se corten */}
      <div className="hero-bg" aria-hidden="true" />
      <div className="hero-t">
        <Icono name={icon} size={46} />
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
                <span className="hero-kpi-l"><Icono name={t.icon} size={14} />{t.n}</span>
                <b><AnimatedNumber value={t.value} format={t.format ?? entero} /></b>
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
