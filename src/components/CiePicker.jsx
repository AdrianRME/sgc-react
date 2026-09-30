import { useId, useState } from 'react';
import { CIE } from '../lib/constants.js';
import { normalize } from '../lib/clinical.js';

/** Buscador CIE-10 tipo combobox: flechas ↑/↓ para moverse, Enter para elegir, Escape para cerrar. */
export function CiePicker({ value, onChange }) {
  const id = useId();
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const nq = normalize(q.trim());
  const results = nq.length < 2 ? [] : CIE.filter((c) => normalize(`${c[0]} ${c[1]}`).includes(nq)).slice(0, 7);
  const open = results.length > 0;

  const pick = (c) => {
    if (!value.some((d) => d[0] === c[0])) onChange([...value, [c[0], c[1], 'P']]);
    setQ('');
    setHi(0);
  };

  const onKey = (e) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + results.length) % results.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[hi]); }
    else if (e.key === 'Escape') setQ('');
  };

  return (
    <div className="field">
      <label htmlFor={id}>Diagnóstico (CIE-10)</label>
      <div className="combo">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-l`}
          aria-activedescendant={open ? `${id}-${hi}` : undefined}
          value={q}
          onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={onKey}
          placeholder="Escriba código o nombre: gripe, J06, gastritis…"
          autoComplete="off"
        />
        {open && (
          <ul className="pick" id={`${id}-l`} role="listbox">
            {results.map((c, i) => (
              <li
                key={c[0]}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === hi}
                onMouseDown={(e) => { e.preventDefault(); pick(c); }}
                onMouseEnter={() => setHi(i)}
              >
                <b className="code">{c[0]}</b> {c[1]}
              </li>
            ))}
          </ul>
        )}
        {nq.length >= 2 && !open && <small className="hint">Sin coincidencias en el catálogo de demostración.</small>}
      </div>
      <div className="chips">
        {value.map((d, i) => (
          <span className="chip" key={d[0]}>
            <b className="code">{d[0]}</b> {d[1]}
            <button
              type="button"
              className={`dxt ${d[2] === 'D' ? 'on' : ''}`}
              title="Cambiar entre presuntivo y definitivo"
              onClick={() => onChange(value.map((x, j) => (j === i ? [x[0], x[1], x[2] === 'D' ? 'P' : 'D'] : x)))}
            >
              {d[2] === 'D' ? 'Definitivo' : 'Presuntivo'}
            </button>
            <button type="button" aria-label={`Quitar ${d[0]}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
          </span>
        ))}
      </div>
    </div>
  );
}
