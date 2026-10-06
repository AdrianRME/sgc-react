import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useStore } from '../store/useStore.js';
import { ClinicalHistory, Recipe, Ticket } from '../components/Documents.jsx';

/**
 * Abre ticket, receta o historia clínica desde cualquier vista. Abrir la historia queda auditado.
 * Acepta el turno o su código; el código se resuelve al dibujar, con los datos ya actualizados
 * (así la receta recién emitida se muestra completa).
 */
export function useDocuments() {
  const { db } = useStore();
  const [doc, setDoc] = useState(null);
  const close = () => setDoc(null);
  const turn = typeof doc?.turn === 'string' ? db.turns.find((x) => x.id === doc.turn) : doc?.turn;
  const openRecipe = (t) => setDoc({ k: 'rec', turn: t });
  const element = (
    <AnimatePresence>
      {doc?.k === 'tk' && turn && <Ticket key="tk" turn={turn} onClose={close} />}
      {doc?.k === 'rec' && turn?.consult && <Recipe key="rec" turn={turn} onClose={close} />}
      {doc?.k === 'hc' && <ClinicalHistory key="hc" dni={doc.dni} onClose={close} onRecipe={openRecipe} />}
    </AnimatePresence>
  );
  return {
    openTicket: (t) => setDoc({ k: 'tk', turn: t }),
    openRecipe,
    openHC: (dni) => setDoc({ k: 'hc', dni }), // la lectura de la historia la audita el repositorio
    element,
  };
}
