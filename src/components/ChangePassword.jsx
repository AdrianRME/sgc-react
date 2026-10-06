import { useState } from 'react';
import { useStore } from '../store/useStore.js';
import { PASSWORD_RULE } from '../lib/constants.js';
import { Field, Msg } from './ui.jsx';
import { Modal } from './Modal.jsx';
import { Icon3D } from './Icon3D.jsx';

/** Fuerza de la contraseña: cuántas reglas cumple (longitud, letras, números, largo extra o símbolos). */
const strength = (p) => [p.length >= 8, /[A-Za-z]/.test(p) && /\d/.test(p), p.length >= 12, /[^A-Za-z0-9]/.test(p)].filter(Boolean).length;
const LEVEL = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Fuerte'];

/**
 * Cambio de contraseña. En modo `forced` (primer ingreso o clave restablecida por Jefatura)
 * no se puede cerrar: la persona debe definir su propia contraseña o salir.
 */
export function ChangePassword({ forced = false, onClose = () => {} }) {
  const { changePassword, signOut, repo } = useStore();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const weak = p1 && !PASSWORD_RULE.re.test(p1);
  const mismatch = p2 && p1 !== p2;
  const level = strength(p1);

  const submit = async (e) => {
    e.preventDefault();
    if (weak || mismatch || !p1) return;
    setBusy(true);
    setErr('');
    try {
      await changePassword(p1);
      onClose();
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal label="Cambiar contraseña" onClose={onClose} size="sm" dismissible={!forced}>
      <Icon3D name="locked" size={48} className="head-icon" />
      <h3>{forced ? 'Defina su contraseña' : 'Cambiar contraseña'}</h3>
      <p>{forced
        ? 'Está usando una contraseña temporal. Por seguridad, defina una contraseña personal antes de continuar.'
        : 'La nueva contraseña reemplaza a la actual en todos sus equipos.'}</p>
      <form onSubmit={submit} noValidate className="stack">
        {repo.kind === 'local' && <Msg tone="warn">En modo local las contraseñas no se guardan por usuario.</Msg>}
        {err && <Msg tone="crit">{err}</Msg>}
        <Field label="Nueva contraseña" error={weak ? PASSWORD_RULE.text : undefined} hint={!weak ? PASSWORD_RULE.text : undefined}>
          {(a) => <input {...a} type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" />}
        </Field>
        {p1 && (
          <div className="pw-meter" aria-live="polite">
            <div className="track">{[0, 1, 2, 3].map((i) => <i key={i} className={i < level ? `on l${level}` : ''} />)}</div>
            <span>{LEVEL[level]}</span>
          </div>
        )}
        <Field label="Repita la contraseña" error={mismatch ? 'No coincide' : undefined}>
          {(a) => <input {...a} type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" />}
        </Field>
        <div className="actions end">
          {forced
            ? <button type="button" className="btn sec" onClick={() => signOut()}>Salir</button>
            : <button type="button" className="btn sec" onClick={onClose}>Cancelar</button>}
          <button className="btn" disabled={busy || !p1 || !p2 || weak || mismatch}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
        </div>
      </form>
    </Modal>
  );
}
