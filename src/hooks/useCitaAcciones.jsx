import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Ban, CalendarClock, LogIn, UserX } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { cancelTurn, checkIn } from '../store/actions.js';
import { CANCEL } from '../lib/constants.js';
import { sameDay } from '../lib/agenda.js';
import { fullName } from '../lib/format.js';
import { CitaForm } from '../components/CitaForm.jsx';
import { Modal } from '../components/Modal.jsx';
import { useNow } from './useNow.js';
import { useConfirm } from './useConfirm.jsx';
import { useDocuments } from './useDocuments.jsx';

/**
 * Acciones sobre una cita programada (registrar la llegada, reprogramar, no asistió o anular), con sus
 * diálogos. Las usan la ventanilla y la agenda.
 */
export function useCitaAcciones() {
  const { run, patient } = useStore();
  const now = useNow();
  const docs = useDocuments();
  const [ask, dialog] = useConfirm();
  const [reprog, setReprog] = useState(null);

  const noAsistio = (t) => ask({
    title: `¿${t.id} no asistió a su cita?`, icon: 'hourglass', danger: true, confirmLabel: 'Cerrar turno',
    text: `La cita de ${fullName(patient(t.dni))} queda como no asistida y el cupo se libera.`,
    onConfirm: () => run(cancelTurn, t.id, CANCEL.noAsistio),
  });
  const anular = (t) => ask({
    title: `Anular la cita de ${t.id}`, danger: true, confirmLabel: 'Anular cita',
    text: `${fullName(patient(t.dni))} pierde la cita y el cupo queda libre. Esta acción no se puede deshacer.`,
    options: [CANCEL.anulado, CANCEL.retiro], onConfirm: (motivo) => run(cancelTurn, t.id, motivo),
  });
  const done = (t) => {
    setReprog(null);
    docs.openCita(t);
  };
  // Quien reservó por web o teléfono va a Caja o triaje: se le entrega su ticket con el recorrido
  const llegada = async (t) => {
    const r = await run(checkIn, t.id);
    if (r.ok && r.result?.state !== 'EN_ESPERA_CONSULTA') docs.openTicket(r.result);
  };
  const acts = (t) => (
    <>
      {sameDay(t.cita.at, now) && <button className="btn sm" onClick={() => llegada(t)}><LogIn /> Registrar llegada</button>}
      <button className="btn sec sm" onClick={() => setReprog(t)}><CalendarClock /> Reprogramar</button>
      {t.cita.at < now ? <button className="btn dng sm" onClick={() => noAsistio(t)}><UserX /> No asistió</button>
        : <button className="btn dng sm" onClick={() => anular(t)}><Ban /> Anular</button>}
    </>
  );
  const element = (
    <>
      <AnimatePresence>
        {reprog && (
          <Modal key="reprog" label={`Reprogramar la cita de ${reprog.id}`} onClose={() => setReprog(null)}>
            <h3>Reprogramar la cita de {reprog.id}</h3>
            <CitaForm turn={reprog} patient={patient(reprog.dni)} onDone={done} />
          </Modal>
        )}
      </AnimatePresence>
      {docs.element}
      {dialog}
    </>
  );
  return { acts, element };
}
