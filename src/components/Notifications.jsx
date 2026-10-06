import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Bell } from 'lucide-react';
import { fmtAgo } from '../lib/format.js';
import { pop, spring } from '../lib/motion.js';
import { Icon3D } from './Icon3D.jsx';
import { Empty } from './ui.jsx';
import { useNow } from '../hooks/useNow.js';
import { useDismiss } from '../hooks/useDismiss.js';

/** Campana con los avisos del espacio (lo que hicieron otras estaciones y le afecta a este rol). */
export function Notifications({ feed }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const now = useNow(30_000);
  const { markRead, unread } = feed;
  useEffect(() => {
    if (open && unread) markRead();
  }, [open, unread, markRead]);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  return (
    <div className="bell" ref={ref}>
      <button
        className="icon-btn"
        aria-label={feed.unread ? `Avisos: ${feed.unread} sin leer` : 'Avisos'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell />
        <AnimatePresence>
          {feed.unread > 0 && (
            <m.span key={feed.unread} className="badge-n" initial={{ scale: 0.4 }} animate={{ scale: 1, transition: spring }} exit={{ scale: 0 }}>
              {feed.unread > 9 ? '9+' : feed.unread}
            </m.span>
          )}
        </AnimatePresence>
      </button>
      <AnimatePresence>
        {open && (
          <m.div {...pop} className="popover notif" role="dialog" aria-label="Avisos">
            <div className="notif-h">
              <b>Avisos</b>
              {feed.items.length > 0 && <button className="btn ghost sm" onClick={feed.clear}>Limpiar</button>}
            </div>
            {feed.items.length ? (
              <ul>
                {feed.items.map((e) => (
                  <li key={e.id} className={e.tone === 'crit' ? 'crit' : ''}>
                    <Icon3D name={e.icon} size={28} />
                    <div>{e.text}<small>{fmtAgo(e.t, now)}</small></div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon="bell" title="Sin avisos nuevos">Aquí verá lo que otras estaciones hacen y le afecta.</Empty>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
