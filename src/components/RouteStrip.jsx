import { Fragment } from 'react';
import { LayoutGroup, m } from 'motion/react';
import { useStore } from '../store/useStore.js';
import { ROUTE, PRIO } from '../lib/constants.js';
import { byStage, waitInfo } from '../lib/clinical.js';
import { startOfToday } from '../lib/format.js';
import { useNow } from '../hooks/useNow.js';
import { spring } from '../lib/motion.js';

const MAX_TOKENS = 6;
const stationColor = (k) => `var(--st-${k === 'alta' ? 'jef' : k})`;

/** Ficha de un turno sobre la ruta. Solo el código: la ruta se ve también en equipos de Jefatura. */
function Token({ t, now }) {
  const w = waitInfo(t, now);
  const label = `${t.id}: ${t.prio ? `prioridad ${PRIO[t.prio][0].toLowerCase()}, ` : ''}${w.min} min${w.late ? ', supera el objetivo' : ''}`;
  return (
    <m.span layout layoutId={`tok-${t.id}`} transition={spring} className={`tok ${w.late ? 'late' : ''}`} title={label}>
      <i className={`pdot ${t.prio || ''}`} aria-hidden="true" />
      {t.id}
    </m.span>
  );
}

function Tokens({ list, now }) {
  return (
    <div className="toks">
      {list.slice(0, MAX_TOKENS).map((t) => <Token key={t.id} t={t} now={now} />)}
      {list.length > MAX_TOKENS && <span className="tok more">+{list.length - MAX_TOKENS}</span>}
    </div>
  );
}

/**
 * La ruta del paciente en vivo: cuatro estaciones y, entre ellas, quién está esperando.
 * Cuando un turno avanza, su ficha se desliza a la siguiente etapa.
 */
export function RouteStrip({ here }) {
  const { db } = useStore();
  const now = useNow(30_000);
  const g = byStage(db.turns);
  const today = startOfToday();
  const stations = {
    adm: { v: db.turns.filter((t) => t.t0 >= today).length, c: 'registrados hoy' },
    enf: { v: g.tri.length, c: g.tri.length === 1 ? 'paciente en triaje' : 'en triaje o llamados', toks: g.tri },
    med: { v: g.med.length, c: 'en consulta o llamados', toks: g.med },
    alta: { v: db.turns.filter((t) => t.state === 'ATENDIDO' && t.tEnd >= today).length, c: 'atendidos hoy' },
  };
  const segments = [
    { c: 'enf', list: g.espTri, lbl: `${g.espTri.length} en espera de triaje` },
    { c: 'med', list: g.espMed, lbl: `${g.espMed.length} en espera de consulta` },
    { c: 'jef', list: [], lbl: 'receta y alta' },
  ];
  return (
    <LayoutGroup id="route">
      <section className="route" aria-label="Ruta del paciente en este momento">
        {ROUTE.map((s, i) => (
          <Fragment key={s.k}>
            <div className={`station ${here === s.k ? 'here' : ''}`} style={{ '--c': stationColor(s.k) }}>
              <i className="st-dot" aria-hidden="true" />
              <span className="st-n">{s.n}</span>
              <b className="st-v">{stations[s.k].v}</b>
              <span className="st-c">{stations[s.k].c}</span>
              {stations[s.k].toks?.length > 0 && <Tokens list={stations[s.k].toks} now={now} />}
            </div>
            {segments[i] && (
              <div className={`seg-line ${segments[i].list.length ? '' : 'empty-seg'}`} style={{ '--c': stationColor(segments[i].c) }}>
                {segments[i].list.length > 0 && <Tokens list={segments[i].list} now={now} />}
                <span className="lbl">{segments[i].lbl}</span>
              </div>
            )}
          </Fragment>
        ))}
      </section>
    </LayoutGroup>
  );
}
