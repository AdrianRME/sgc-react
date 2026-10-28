import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { PhoneCall } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { byPriority, turnKey } from '../lib/clinical.js';
import { QUEUE } from '../lib/constants.js';
import { citasDelDia, porDia, sameDay } from '../lib/agenda.js';
import { fmtCitaDia, fullName, initials, startOfDay } from '../lib/format.js';
import { listItem } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { useDocuments } from '../hooks/useDocuments.jsx';
import { useCitaAcciones } from '../hooks/useCitaAcciones.jsx';
import { SectionHero } from '../components/SectionHero.jsx';
import { CitaForm, CitaRow } from '../components/CitaForm.jsx';
import { Empty, EspOptions, Panel, PrioBadge, TurnCode, WaitTime } from '../components/ui.jsx';
import { HorarioSemanal } from '../components/HorarioSemanal.jsx';
import { Modal } from '../components/Modal.jsx';
import { ReservaCita } from './CitaWeb.jsx';
import './workspaces.css';

/** Color de cada prioridad en las tarjetas (el de su etiqueta). */
const PRIO_C = { CRITICA: 'var(--crit)', PRIORITARIA: 'var(--warn)', NORMAL: 'var(--good)' };

/** Filtros de «Asignar citas»: por prioridad, más las citas que ya se dieron hoy. */
const FILTROS_CITA = [
  { k: 'todos', n: 'Por citar', icon: 'clipboard', c: 'adm' },
  { k: 'CRITICA', n: 'Críticos', icon: 'warning', c: 'crit' },
  { k: 'PRIORITARIA', n: 'Prioritarios', icon: 'bell', c: 'warn' },
  { k: 'NORMAL', n: 'Normales', icon: 'check', c: 'good' },
  { k: 'dadas', n: 'Citas dadas hoy', icon: 'calendar', c: 'med' },
];

/**
 * Asignar citas: los pacientes que terminaron el triaje sin cita (Enfermería se la da al terminar; aquí quedan
 * los que no) y el formulario con la cita que propone el sistema.
 */
export default function Citas() {
  const { db, patient } = useStore();
  const now = useNow();
  const docs = useDocuments();
  const { acts, element } = useCitaAcciones();
  const [filter, setFilter] = useState('todos');
  const [selId, setSelId] = useState(null);
  const pend = db.turns.filter((t) => QUEUE.adm.includes(t.state)).sort(byPriority);
  const dadas = db.turns.filter((t) => t.cita && t.tCita && sameDay(t.tCita, now)).sort((a, b) => b.tCita - a.tCita);
  const count = (k) => (k === 'todos' ? pend.length : k === 'dadas' ? dadas.length : pend.filter((t) => t.prio === k).length);
  const lista = filter === 'todos' || filter === 'dadas' ? pend : pend.filter((t) => t.prio === filter);
  const sel = lista.find((t) => t.id === selId) || lista[0];
  const done = (t) => {
    setSelId(null);
    docs.openCita(t);
  };

  return (
    <>
      <SectionHero
        icon="calendar"
        kicker="Admisión"
        title="Asignar citas"
        text="La cita se da al terminar el triaje. Aquí quedan los pacientes a los que Enfermería no se la dio: elija uno y confirme la cita que propone el sistema."
        tiles={FILTROS_CITA.map((f) => ({ ...f, value: count(f.k) }))}
        active={filter}
        onPick={setFilter}
        label="Pacientes por prioridad"
      />
      {filter === 'dadas' ? (
        <Panel title="Citas dadas hoy" count={dadas.length} icon="calendar" sub="Por Enfermería al terminar el triaje o aquí, en Admisión">
          {dadas.length ? (
            <ul className="cita-list">
              <AnimatePresence initial={false}>
                {dadas.map((t) => <CitaRow key={turnKey(t)} t={t} now={now} actions={t.state === 'CITADO' ? acts(t) : null} />)}
              </AnimatePresence>
            </ul>
          ) : <Empty icon="calendar" title="Todavía no se dio ninguna cita hoy" />}
        </Panel>
      ) : (
        <div className="grid-2 citas-grid">
          <Panel title="Terminaron el triaje" count={lista.length} icon="clipboard" sub="Los críticos y prioritarios primero" className="adm-list">
            {lista.length ? (
              <ul className="pacs">
                <AnimatePresence initial={false}>
                  {lista.map((t) => {
                    const p = patient(t.dni);
                    return (
                      <m.li key={t.id} {...listItem} layout>
                        <button type="button" className="pac pick" style={{ '--c': PRIO_C[t.prio] }} aria-pressed={sel?.id === t.id} onClick={() => setSelId(t.id)}>
                          <span className="pac-av" aria-hidden="true">{initials(fullName(p))}</span>
                          <span className="pac-main">
                            <b>{fullName(p)}</b>
                            <span className="pac-meta">
                              <TurnCode id={t.id} />
                              <PrioBadge prio={t.prio} />
                              <WaitTime turn={t} now={now} />
                            </span>
                            {t.tri?.motivo && <span className="pac-motivo">{t.tri.motivo}</span>}
                          </span>
                        </button>
                      </m.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            ) : <Empty icon="check" title="Nadie espera su cita">Enfermería da la cita al terminar el triaje.</Empty>}
          </Panel>
          <Panel title="Asignar cita" icon="sparkles" className="adm-reg">
            <AnimatePresence mode="wait">
              {sel ? (
                <m.div key={sel.id} {...listItem}>
                  <CitaForm turn={sel} patient={patient(sel.dni)} onDone={done} preselect />
                </m.div>
              ) : (
                <m.div key="none" {...listItem}>
                  <Empty icon="calendar" title="Ningún paciente por citar">Cuando un paciente queda sin cita después del triaje, aparece aquí.</Empty>
                </m.div>
              )}
            </AnimatePresence>
          </Panel>
        </div>
      )}
      {docs.element}
      {element}
    </>
  );
}

/** Filtros de la agenda. */
const FILTROS_AGENDA = [
  { k: 'hoy', n: 'Citas de hoy', icon: 'calendar', c: 'adm' },
  { k: 'llegan', n: 'Por llegar hoy', icon: 'hourglass', c: 'caj' },
  { k: 'llegaron', n: 'Ya llegaron', icon: 'check', c: 'med' },
  { k: 'proximas', n: 'Próximos días', icon: 'clipboard', c: 'enf' },
  { k: 'vencidas', n: 'Vencidas', icon: 'warning', c: 'crit' },
];
const AGENDA_SUB = {
  hoy: 'Todas las citas de hoy. Al llegar el paciente, registre su llegada: pasa a la espera de su médico.',
  llegan: 'Tienen cita hoy y todavía no se presentan.',
  llegaron: 'Ya registraron su llegada: esperan, están con su médico o ya fueron atendidos.',
  proximas: 'Pacientes que vuelven otro día. Se pueden reprogramar o anular.',
  vencidas: 'La fecha de la cita pasó sin registrar la llegada: reprograme o marque «No asistió».',
};

/** Agenda de citas: las de hoy, las próximas y las vencidas, más el horario de los médicos. */
export function Agenda() {
  const { db } = useStore();
  const now = useNow();
  const { acts, element } = useCitaAcciones();
  const [filter, setFilter] = useState('hoy');
  const [esp, setEsp] = useState('');
  const [tel, setTel] = useState(false);
  const hoy = citasDelDia(db.turns, now);
  const citados = db.turns.filter((t) => t.state === 'CITADO').sort((a, b) => a.cita.at - b.cita.at);
  const listas = {
    hoy,
    llegan: hoy.filter((t) => t.state === 'CITADO'),
    llegaron: hoy.filter((t) => t.state !== 'CITADO'),
    proximas: citados.filter((t) => startOfDay(t.cita.at) > startOfDay(now)),
    vencidas: citados.filter((t) => t.cita.at < startOfDay(now)),
  };
  const f = FILTROS_AGENDA.find((x) => x.k === filter);
  const lista = listas[filter];
  const card = (t) => <CitaRow key={turnKey(t)} t={t} now={now} actions={t.state === 'CITADO' ? acts(t) : null} />;

  return (
    <>
      <SectionHero
        icon="clipboard"
        kicker="Admisión"
        title="Agenda de citas"
        text="Las citas de hoy y de los próximos días. Desde aquí se registra la llegada, se reprograman, se anulan o se marca a quien no asistió."
        tiles={FILTROS_AGENDA.map((x) => ({ ...x, value: listas[x.k].length }))}
        active={filter}
        onPick={setFilter}
        label="Citas por estado"
        actions={<button type="button" className="btn" onClick={() => setTel(true)}><PhoneCall /> Cita por teléfono</button>}
      />
      <Panel title={f.n} count={lista.length} icon={f.icon} sub={AGENDA_SUB[filter]} className="adm-list" data-role={f.c}>
        {!lista.length ? (
          <Empty icon="check" title="No hay citas en esta lista" />
        ) : filter === 'proximas' ? (
          porDia(lista.map((t) => ({ at: t.cita.at, t }))).map(({ day, cupos }) => (
            <section key={day}>
              <h3 className="cita-day">{fmtCitaDia(day, now)} <small>{cupos.length} {cupos.length === 1 ? 'cita' : 'citas'}</small></h3>
              <ul className="cita-list">{cupos.map(({ t }) => card(t))}</ul>
            </section>
          ))
        ) : (
          <ul className="cita-list">
            <AnimatePresence initial={false}>{lista.map(card)}</AnimatePresence>
          </ul>
        )}
      </Panel>

      <Panel
        title="Horario de atención"
        icon="calendar"
        sub="Días y horas en que atiende cada médico. Con este horario el sistema calcula los cupos."
        actions={(
          <select className="input sm-select" aria-label="Especialidad" value={esp} onChange={(e) => setEsp(e.target.value)}>
            <option value="">Todas las especialidades</option>
            <EspOptions />
          </select>
        )}
        className="agenda-horario"
      >
        <HorarioSemanal esp={esp || null} />
      </Panel>
      <AnimatePresence>
        {tel && (
          <Modal key="tel" label="Cita por teléfono" onClose={() => setTel(false)}>
            <h3>Cita por teléfono</h3>
            <ReservaCita telefono />
          </Modal>
        )}
      </AnimatePresence>
      {element}
    </>
  );
}
