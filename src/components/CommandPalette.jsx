import { useId, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { normalize } from '../lib/clinical.js';
import { Modal } from './Modal.jsx';
import { Kbd } from './ui.jsx';

/**
 * Paleta de comandos (Ctrl + K): ir a cualquier sección o ejecutar una acción frecuente sin el mouse.
 * commands: [{ id, group, label, icon, hint?, keywords?, run }]
 */
export function CommandPalette({ commands, onClose }) {
  const id = useId();
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const nq = normalize(q.trim());
  const list = commands.filter((c) => !nq || normalize(`${c.label} ${c.group} ${c.keywords || ''}`).includes(nq));
  const sel = Math.min(hi, Math.max(0, list.length - 1));

  const pick = (c) => {
    onClose();
    c.run();
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((sel + 1) % Math.max(1, list.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((sel - 1 + list.length) % Math.max(1, list.length)); }
    else if (e.key === 'Enter' && list[sel]) { e.preventDefault(); pick(list[sel]); }
  };

  return (
    <Modal label="Buscar o ir a" onClose={onClose} className="palette">
      <div className="p-in">
        <Search aria-hidden="true" />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-l`}
          aria-activedescendant={list[sel] ? `${id}-${list[sel].id}` : undefined}
          aria-label="Buscar una sección o acción"
          placeholder="Escriba una sección o acción…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={onKey}
          autoComplete="off"
        />
      </div>
      <ul id={`${id}-l`} role="listbox" aria-label="Resultados">
        {list.length === 0 && <li className="grp">Nada coincide con «{q}».</li>}
        {list.map((c, i) => (
          <li key={c.id} role="presentation">
            {(i === 0 || list[i - 1].group !== c.group) && <div className="grp" role="presentation">{c.group}</div>}
            <div
              id={`${id}-${c.id}`}
              role="option"
              aria-selected={i === sel}
              className="opt"
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
            >
              {c.icon && <c.icon aria-hidden="true" />}
              <span>{c.label}</span>
              {c.hint && <span className="k">{c.hint}</span>}
            </div>
          </li>
        ))}
      </ul>
      <div className="p-foot" aria-hidden="true">
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd> moverse</span>
        <span><Kbd><CornerDownLeft size={12} /></Kbd> elegir</span>
        <span><Kbd>Esc</Kbd> cerrar</span>
      </div>
    </Modal>
  );
}
