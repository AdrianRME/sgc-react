import { AnimatePresence, m } from 'motion/react';
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { aviso } from '../lib/motion.js';

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
              {...aviso}
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
