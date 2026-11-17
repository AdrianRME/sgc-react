/**
 * Marca del sistema: la cruz clínica calada en una ficha del verde de la marca. En el brazo derecho lleva las
 * tres estaciones de la ruta (Admisión, Triaje, Consulta) como una pestaña de archivador.
 */
export function BrandMark({ className = 'brand-mark' }) {
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="8" fill="var(--brand)" />
      <path d="M16.5 9h7v7.5H31v7h-7.5V31h-7v-7.5H9v-7h7.5z" fill="var(--surface)" />
      <rect x="33" y="9" width="3" height="6" rx="1" fill="var(--st-adm)" />
      <rect x="33" y="17" width="3" height="6" rx="1" fill="var(--st-enf)" />
      <rect x="33" y="25" width="3" height="6" rx="1" fill="var(--st-med)" />
    </svg>
  );
}
