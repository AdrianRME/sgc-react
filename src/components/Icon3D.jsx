/**
 * Íconos 3D (Fluent Emoji de Microsoft, licencia MIT: src/assets/icons3d/LICENSE-fluentui-emoji.txt).
 * Se usan para orientarse (espacio de cada rol, secciones y estados vacíos), no dentro de tablas densas.
 */
const files = import.meta.glob('../assets/icons3d/*.webp', { eager: true, query: '?url', import: 'default' });
const ICONS = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.match(/([\w-]+)\.webp$/)[1], url]));

export function Icon3D({ name, size = 40, alt = '', className = '' }) {
  const src = ICONS[name];
  if (!src) return null;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      className={`i3d ${className}`}
      decoding="async"
      draggable="false"
    />
  );
}
