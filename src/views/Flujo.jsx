import { useState } from 'react';
import { AnimatePresence, LayoutGroup, m } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { AREAS, STAGES, TRIAGE_MODULES, modulosTriaje } from '../lib/constants.js';
import { byStage, turnKey, waitInfo } from '../lib/clinical.js';
import { estimarEsperas, rangoEspera } from '../lib/espera.js';
import { fullName } from '../lib/format.js';
import { tarjeta } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { SectionHero } from '../components/SectionHero.jsx';
import { Help } from '../components/WorkspaceHeader.jsx';
import { Acordeon, Grupo } from '../components/Acordeon.jsx';
import { Empty, Msg, PrioBadge, TurnCode, WaitTime } from '../components/ui.jsx';
import { Icono } from '../components/Icono.jsx';
import '../styles/vistas/flujo.css';

/**
 * Ocupación de las salas: quién está siendo atendido y a quién se está llamando. Las salas se agrupan por
 * estación (módulos de triaje y consultorios) en un acordeón: cada grupo resume cuántas están ocupadas y,
 * abierto, muestra solo las que tienen actividad; las libres van en una línea. Así el bloque no crece con
 * cada consultorio que se abra.
 */
function Rooms({ turns, users, now }) {
  // Un módulo de triaje por enfermera activa (y los que tengan un paciente, aunque sean más)
  const enUso = new Set(turns.filter((t) => ['EN_TRIAJE', 'LLAMADO_TRIAJE'].includes(t.state)).map((t) => t.dest));
  const modulos = TRIAGE_MODULES.filter((m, i) => i < modulosTriaje(users) || enUso.has(m));
  const estado = (room, busyState, callState) => {
    const busy = turns.find((t) => t.state === busyState && t.dest === room);
    return { room, busy, calling: turns.filter((t) => t.state === callState && t.dest === room) };
  };
  const grupos = [
    { k: 'enf', n: 'Módulos de triaje', icon: 'thermometer', rooms: modulos.map((x) => estado(x, 'EN_TRIAJE', 'LLAMADO_TRIAJE')) },
    { k: 'med', n: 'Consultorios', icon: 'stethoscope', rooms: AREAS.map((x) => estado(x, 'EN_CONSULTA', 'LLAMADO_CONSULTA')) },
  ];
  return (
    <Acordeon barra={false}>
      {grupos.map((g) => {
        const activas = g.rooms.filter((r) => r.busy || r.calling.length);
        const libres = g.rooms.filter((r) => !r.busy && !r.calling.length);
        const ocupadas = g.rooms.filter((r) => r.busy).length;
        const llamando = g.rooms.filter((r) => r.calling.length).length;
        return (
          <Grupo
            key={g.k}
            titulo={g.n}
            sub={`${ocupadas} ${ocupadas === 1 ? 'ocupado' : 'ocupados'} · ${llamando} llamando · ${libres.length} ${libres.length === 1 ? 'libre' : 'libres'}`}
            cuenta={g.rooms.length}
            color={`var(--st-${g.k})`}
            abierto={activas.length > 0}
          >
            {activas.length > 0 && (
              <div className="rooms" data-role={g.k}>
                {activas.map(({ room, busy, calling }) => {
                  const who = busy && users.find((u) => u.u === (busy.med || busy.enf))?.n;
                  const since = busy ? Math.max(0, Math.round((now - (busy.tMedCall || busy.tTriCall || busy.t0)) / 60000)) : 0;
                  return (
                    <div className={`room ${busy ? 'busy' : ''}`} key={room}>
                      <Icono name={g.icon} size={36} />
                      <div className="room-b">
                        <b>{room}</b>
                        {busy
                          ? <span>Atendiendo <TurnCode id={busy.id} /> desde hace {since} min{who ? `, ${who}` : ''}</span>
                          : <span>Sin paciente en atención</span>}
                        {calling.length > 0 && <span className="calling">Llamando a {calling.map((t) => t.id).join(', ')}</span>}
                      </div>
                      <span className={`room-st ${busy ? 'on' : ''}`}>{busy ? 'Ocupado' : 'Llamando'}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {libres.length > 0 && <p className="rooms-libres"><b>Libres:</b> {libres.map((r) => r.room).join(' · ')}</p>}
          </Grupo>
        );
      })}
    </Acordeon>
  );
}

/** Filtros del tablero: todos, por gravedad o los que ya superan el tiempo objetivo de espera. */
const FILTROS_FLUJO = [
  { k: 'todos', n: 'En el centro', icon: 'hospital', c: 'adm', of: () => true },
  { k: 'crit', n: 'Críticos', icon: 'warning', c: 'crit', of: (t) => t.prio === 'CRITICA' },
  { k: 'prio', n: 'Prioritarios', icon: 'bell', c: 'warn', of: (t) => t.prio === 'PRIORITARIA' },
  { k: 'late', n: 'Sobre el tiempo objetivo', icon: 'hourglass', c: 'caj', of: (t, now) => waitInfo(t, now).late },
];

/**
 * Tablero en vivo: cada columna es una etapa de la ruta. Cuando un turno avanza, su tarjeta se desliza
 * a la siguiente columna. Jefatura ve solo códigos; Admisión ve además el nombre del paciente.
 */
export default function Flujo() {
  const { db, user, patient } = useStore();
  const now = useNow(30_000);
  const [filter, setFilter] = useState('todos');
  const enCentro = db.turns.filter((t) => STAGES.some((s) => s.states.includes(t.state)));
  const match = FILTROS_FLUJO.find((f) => f.k === filter).of;
  const g = byStage(db.turns.filter((t) => match(t, now)));
  // Admisión ve el nombre para orientar al paciente; Jefatura trabaja solo con códigos
  const pat = (t) => (user.role === 'adm' ? patient(t.dni) : null);
  const citados = db.turns.filter((t) => t.state === 'CITADO').length;
  const est = estimarEsperas(db.turns, now, { modulos: modulosTriaje(db.users) });
  return (
    <>
      <SectionHero
        icon="satellite"
        kicker={user.role === 'jef' ? 'Jefatura' : 'Admisión'}
        title="Flujo en vivo"
        text="Dónde está cada paciente en este momento. Las tarjetas avanzan solas cuando otra estación llama, atiende o da de alta. Pulse una cifra para ver solo esos pacientes."
        tiles={FILTROS_FLUJO.map((f) => ({ ...f, value: enCentro.filter((t) => f.of(t, now)).length }))}
        active={filter}
        onPick={setFilter}
        label="Filtrar el tablero"
        actions={<Help role={user.role} />}
      />
      <Rooms turns={db.turns} users={db.users} now={now} />
      {citados > 0 && <Msg tone="info">Además, {citados} {citados === 1 ? 'paciente tiene' : 'pacientes tienen'} cita para más tarde u otro día: no {citados === 1 ? 'está' : 'están'} en el centro hasta que Admisión registre su llegada.</Msg>}
      <LayoutGroup id="board">
        <div className="board">
          {STAGES.map((s) => (
            <section className="col" key={s.k} style={{ '--c': `var(--st-${s.st})` }} aria-label={s.n}>
              <header className={s.wait ? 'wait' : ''}>
                <i aria-hidden="true" />
                <h2>{s.n}</h2>
                <span className="count">{g[s.k].length}</span>
              </header>
              <div className="cards">
                <AnimatePresence initial={false}>
                  {g[s.k].map((t) => {
                    const p = pat(t);
                    const late = waitInfo(t, now).late;
                    return (
                      <m.article
                        key={t.id}
                        layout
                        layoutId={`card-${t.id}`}
                        {...tarjeta}
                        className={`card ${t.prio === 'CRITICA' ? 'crit' : ''} ${late ? 'late' : ''}`}
                      >
                        <div className="card-h">
                          <TurnCode id={t.id} />
                          <PrioBadge prio={t.prio} />
                        </div>
                        {p && <span className="card-n">{fullName(p)}</span>}
                        <div className="card-f">
                          <WaitTime turn={t} now={now} />
                          {t.state.startsWith('LLAMADO') && t.dest && <span className="to"><ArrowRight aria-hidden="true" />{t.dest}</span>}
                          {est.has(turnKey(t)) && <span className="eta" title="Tiempo aproximado hasta su llamado (RF-14)">Faltan {rangoEspera(est.get(turnKey(t)), { aprox: true })}</span>}
                        </div>
                      </m.article>
                    );
                  })}
                </AnimatePresence>
                {!g[s.k].length && <Empty icon={s.wait ? 'check' : 'hourglass'}>{s.wait ? 'Nadie esperando' : 'Sin pacientes en esta etapa'}</Empty>}
              </div>
            </section>
          ))}
        </div>
      </LayoutGroup>
    </>
  );
}
