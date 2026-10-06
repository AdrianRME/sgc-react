import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { diffEvents } from '../lib/activity.js';

/**
 * Centro de notificaciones del espacio: compara cada carga de datos con la anterior y guarda
 * los últimos avisos para el rol. Los críticos además se muestran como aviso emergente.
 */
export function useActivity(db, user, onCritical) {
  const prev = useRef(null);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (db && prev.current && user) {
      const events = diffEvents(prev.current, db, user);
      if (events.length) {
        const t = Date.now();
        setItems((x) => [...events.map((e, i) => ({ ...e, id: `${t}-${i}`, t })), ...x].slice(0, 30));
        setUnread((n) => n + events.length);
        events.filter((e) => e.tone === 'crit').forEach((e) => onCritical?.(e.text));
      }
    }
    prev.current = db;
  }, [db, user, onCritical]);
  const markRead = useCallback(() => setUnread(0), []);
  const clear = useCallback(() => {
    setItems([]);
    setUnread(0);
  }, []);
  return useMemo(() => ({ items, unread, markRead, clear }), [items, unread, markRead, clear]);
}
