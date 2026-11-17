import {
  Activity, Ambulance, BedSingle, Bell, BriefcaseMedical, Building2, CalendarDays, ChartColumn, CircleCheck, ClipboardList,
  Droplet, FolderOpen, HeartPulse, Hospital, Hourglass, House, IdCard, Keyboard, Lightbulb, LockKeyhole, Megaphone, Pill,
  ScrollText, Search, ShieldCheck, SlidersHorizontal, SquarePen, Stethoscope, Thermometer, Ticket, Timer, TrendingUp,
  TriangleAlert, Tv, Users, Wind,
} from 'lucide-react';

/**
 * Íconos del sistema: de línea (Lucide), todos con el mismo trazo. Sirven para orientarse (espacio de cada rol,
 * secciones y estados vacíos). Los nombres son los del dominio, no los de la librería: para cambiar un dibujo
 * basta tocar esta tabla.
 */
const ICONOS = {
  ambulance: Ambulance, barchart: ChartColumn, bed: BedSingle, bell: Bell, blood: Droplet, bulb: Lightbulb,
  calendar: CalendarDays, chartup: TrendingUp, check: CircleCheck, clipboard: ClipboardList, folder: FolderOpen,
  heart: HeartPulse, hospital: Hospital, hourglass: Hourglass, house: House, idcard: IdCard, keyboard: Keyboard,
  knobs: SlidersHorizontal, locked: LockKeyhole, lungs: Wind, megaphone: Megaphone, nurse: BriefcaseMedical,
  office: Building2, people: Users, pill: Pill, satellite: Activity, scroll: ScrollText, search: Search,
  shield: ShieldCheck, sparkles: SquarePen, stethoscope: Stethoscope, stopwatch: Timer, thermometer: Thermometer,
  ticket: Ticket, tv: Tv, warning: TriangleAlert,
};

/**
 * `size` es el lado en píxeles. Desde 30 px el ícono va sobre una ficha teñida del color de la estación;
 * más pequeño (o con `plain`) va suelto y hereda el color del texto.
 */
export function Icono({ name, size = 40, alt = '', className = '', plain = size < 30 }) {
  const Dibujo = ICONOS[name];
  if (!Dibujo) return null;
  return (
    <span
      className={`ico ${plain ? 'suelto' : ''} ${className}`}
      style={{ '--s': `${size}px` }}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
    >
      <Dibujo />
    </span>
  );
}
