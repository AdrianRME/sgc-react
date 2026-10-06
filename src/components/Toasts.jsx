import { AnimatePresence, m } from 'motion/react';
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { spring, quick } from '../lib/motion.js';

const ICON = { ok: CircleCheck, crit: TriangleAlert, warn: TriangleAlert, info: Info };

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICON[t.tone] || Info;
          return (
            <m.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1, transition: spring }}
              exit={{ opacity: 0, x: 40, transition: quick }}
              className={`toast ${t.tone}`}
              role={t.tone === 'crit' ? 'alert' : 'status'}
            >
              <Icon aria-hidden="true" />
              <span>{t.text}</span>
              <button className="icon-btn sm" onClick={() => dismissToast(t.id)} aria-label="Cerrar aviso"><X /></button>
            </m.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
