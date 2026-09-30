import { useStore } from '../store/StoreProvider.jsx';

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast msg ${t.tone}`} role={t.tone === 'crit' ? 'alert' : 'status'}>
          <span>{t.text}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="Cerrar aviso">×</button>
        </div>
      ))}
    </div>
  );
}
