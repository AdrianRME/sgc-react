/** Marca del sistema: la ruta del paciente (Admisión → Triaje → Consulta → Alta) como una línea de metro. */
export function BrandMark({ className = 'brand-mark' }) {
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="var(--ink)" />
      <path d="M9 27 L17 27 Q20 27 20 24 L20 16 Q20 13 23 13 L31 13" fill="none" stroke="var(--paper)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="9" cy="27" r="3.4" fill="var(--st-adm)" stroke="var(--ink)" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="3.4" fill="var(--st-enf)" stroke="var(--ink)" strokeWidth="1.5" />
      <circle cx="31" cy="13" r="3.4" fill="var(--st-med)" stroke="var(--ink)" strokeWidth="1.5" />
    </svg>
  );
}
