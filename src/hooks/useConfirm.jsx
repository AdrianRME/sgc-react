import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { ConfirmDialog } from '../components/Modal.jsx';

/** Confirmación declarativa: const [ask, dialog] = useConfirm(); ask({ title, text, onConfirm }). */
export function useConfirm() {
  const [cfg, setCfg] = useState(null);
  const dialog = (
    <AnimatePresence>
      {cfg && (
        <ConfirmDialog
          key="confirm"
          {...cfg}
          onCancel={() => setCfg(null)}
          onConfirm={(v) => {
            setCfg(null);
            cfg.onConfirm(v);
          }}
        />
      )}
    </AnimatePresence>
  );
  return [setCfg, dialog];
}

/** Confirmación para cerrar el turno de un paciente que no respondió al llamado. */
export const noShowDialog = (t, text, onConfirm) => ({
  title: `¿${t.id} no se presentó?`,
  icon: 'hourglass',
  text,
  confirmLabel: 'Cerrar turno',
  danger: true,
  onConfirm,
});
