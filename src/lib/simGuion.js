/**
 * Guion de la simulación en vivo: lo que un cursor virtual hace en la pantalla REAL de cada estación (escribe en
 * los campos, elige opciones y pulsa los botones), para que se vea cómo se usa el sistema. Las pantallas son las
 * mismas del personal; solo cambian los datos (una copia de prueba) y quién está frente al equipo.
 *
 * Cada guion termina pulsando el botón de la acción. Si un elemento no aparece (por ejemplo, la pantalla cambió),
 * el guion se rinde y la simulación aplica el resultado del paso igual, para no quedarse a medias.
 */
import { METODOS_PAGO } from './constants.js';
import { allergyConflicts } from './clinical.js';

export const ABORTAR = Symbol('abortar');
export const SALTAR = Symbol('saltar');

/** Control de la reproducción: pausa, salto de paso y detención. Toda espera del guion pasa por aquí. */
export function crearControl() {
  const c = {
    pausa: false, saltar: false, abortado: false, velocidad: 1,
    async espera(ms) {
      let falta = ms / c.velocidad;
      while (falta > 0 || c.pausa) {
        if (c.abortado) throw ABORTAR;
        if (c.saltar) throw SALTAR;
        await new Promise((r) => setTimeout(r, 50));
        if (!c.pausa) falta -= 50;
      }
      if (c.abortado) throw ABORTAR;
      if (c.saltar) throw SALTAR;
    },
  };
  return c;
}

const texto = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const visible = (el) => !!el && el.getClientRects().length > 0;

/** Herramientas del cursor virtual sobre la pantalla de la estación (`raiz`). */
export function crearDriver(raiz, ctl, ui) {
  const d = {
    /** Espera a que `fn` devuelva algo (un elemento, por ejemplo). Si no aparece, el guion se rinde. */
    async esperarA(fn, ms = 6000) {
      for (let t = 0; t < ms; t += 100) {
        const x = fn();
        if (x) return x;
        await ctl.espera(100);
      }
      throw new Error('No apareció el elemento esperado en la pantalla.');
    },
    campo(etiqueta) {
      const lab = [...raiz.querySelectorAll('label')].find((l) => texto(l).startsWith(etiqueta) && l.htmlFor);
      const el = lab && document.getElementById(lab.htmlFor);
      return visible(el) ? el : null;
    },
    /** Botón por su nombre: primero el que se llama exactamente así, luego el que lo contiene. */
    boton(nombre, dentro = raiz) {
      const bs = [...dentro.querySelectorAll('button')].filter(visible);
      return bs.find((x) => texto(x) === nombre) || bs.find((x) => texto(x).includes(nombre)) || null;
    },
    /** Lleva el cursor al elemento (y lo deja a la vista). */
    async mover(el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await ctl.espera(350);
      const r = el.getBoundingClientRect();
      ui.cursor(r.left + Math.min(r.width / 2, 60), r.top + r.height / 2);
      await ctl.espera(550);
    },
    async pulsar(el, nota) {
      await d.mover(el);
      if (nota) await d.nota(el, nota);
      ui.clic();
      el.classList.add('sim-foco');
      await ctl.espera(220);
      el.classList.remove('sim-foco');
      el.click();
      await ctl.espera(400);
    },
    /** Escribe como una persona: letra por letra, con el valor que React recibe en cada tecla. */
    async escribir(el, valor, { deUna = false } = {}) {
      await d.mover(el);
      el.classList.add('sim-foco');
      el.focus({ preventScroll: true });
      const v = String(valor ?? '');
      if (deUna || el.type === 'date') {
        poner(el, v);
        await ctl.espera(350);
      } else {
        if (el.value) poner(el, '');
        for (let n = 1; n <= v.length; n++) {
          const parcial = v.slice(0, n);
          // Un campo numérico no acepta «38.» a medias: esa tecla se escribe junto con la siguiente
          if (el.type === 'number' && /[.,]$/.test(parcial) && n < v.length) continue;
          poner(el, parcial);
          await ctl.espera(55);
        }
      }
      el.classList.remove('sim-foco');
      await ctl.espera(180);
    },
    async elegir(el, valor) {
      await d.mover(el);
      el.classList.add('sim-foco');
      await ctl.espera(300);
      poner(el, valor);
      await ctl.espera(450);
      el.classList.remove('sim-foco');
    },
    /** Globo junto al elemento con una explicación breve. */
    async nota(el, msg, ms = 2600) {
      await d.mover(el);
      el.classList.add('sim-foco');
      ui.nota(el.getBoundingClientRect(), msg);
      try {
        await ctl.espera(ms);
      } finally {
        ui.nota(null);
        el.classList.remove('sim-foco');
      }
    },
  };
  return d;
}

/** Cambia el valor de un campo controlado por React y dispara el evento que este escucha. */
function poner(el, v) {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

/** Cierra los documentos abiertos del paso anterior (ticket, boleta, constancia de cita, receta). */
export async function cerrarDocumentos(raiz, d, ctl) {
  for (const x of raiz.querySelectorAll('.dialog-x')) {
    await d.pulsar(x);
    await ctl.espera(250);
  }
}

const VITALES = [['pa', 'PA (mmHg)'], ['fc', 'FC (lpm)'], ['fr', 'FR (rpm)'], ['t', 'Temp. (°C)'], ['spo2', 'SpO₂ (%)'], ['peso', 'Peso (kg)'], ['talla', 'Talla (m)']];

/** Guiones por tipo de paso: `u` es el `ui` del paso en lib/simulacion.js. */
export const GUIONES = {
  async buscar(d, u) {
    const casilla = await d.esperarA(() => d.raiz.querySelector('.sis-test input'));
    if (!!u.caido !== casilla.checked) await d.pulsar(casilla, u.caido ? 'Simula que el servicio del SIS no responde' : undefined);
    const q = await d.esperarA(() => d.raiz.querySelector('#adm-q'));
    await d.escribir(q, u.dni);
    await d.pulsar(await d.esperarA(() => d.boton('Buscar')));
    await d.esperarA(() => d.raiz.querySelector('.ficha'), 8000);
  },
  async sis(d) {
    const badge = await d.esperarA(() => d.raiz.querySelector('.ficha > :last-child'));
    await d.nota(badge, 'Respuesta del SIS', 2200);
    const sig = d.raiz.querySelector('.next-step') || d.raiz.querySelector('.adm-reg .msg');
    if (sig) await d.nota(sig, 'El sistema indica el siguiente paso', 2200);
  },
  async registrar(d, u) {
    if (u.nuevo) {
      await d.escribir(await d.esperarA(() => d.campo('Nombres')), u.form.nom);
      await d.escribir(d.campo('Apellidos'), u.form.ape);
      await d.escribir(d.campo('Fecha de nacimiento'), u.form.nac);
      await d.elegir(d.campo('Sexo'), u.form.sexo);
      await d.escribir(d.campo('Teléfono'), u.form.tel);
    } else {
      await d.escribir(await d.esperarA(() => d.campo('Teléfono de contacto')), u.form.tel);
    }
    await d.pulsar(await d.esperarA(() => d.boton('Generar turno')));
  },
  async cobrar(d, u, f) {
    const tarjeta = await d.esperarA(() => [...d.raiz.querySelectorAll('.caj-pac')].find((b) => texto(b).includes(f.turno?.id ?? '')));
    if (tarjeta.getAttribute('aria-pressed') !== 'true') await d.pulsar(tarjeta);
    const medio = await d.esperarA(() => [...d.raiz.querySelectorAll('.dest-opt')].find((l) => texto(l).includes(METODOS_PAGO[u.metodo])));
    await d.pulsar(medio);
    if (u.metodo === 'EFECTIVO') await d.escribir(await d.esperarA(() => d.campo('Monto recibido')), u.recibido);
    const boton = await d.esperarA(() => [...d.raiz.querySelectorAll('button')].find((b) => texto(b).includes('Registrar pago')));
    if (boton.disabled) {
      await d.nota(boton, 'El botón queda bloqueado: el monto no cubre la tarifa', 3200);
      return;
    }
    const vuelto = d.raiz.querySelector('.cash-row .imc');
    if (vuelto) await d.nota(vuelto, 'El sistema calcula el vuelto', 1800);
    await d.pulsar(boton);
  },
  async llamar(d) {
    await d.pulsar(await d.esperarA(() => d.boton('Llamar siguiente') || d.boton('Llamar')), 'El llamado sale en la pantalla de sala');
  },
  async rellamar(d) {
    await d.pulsar(await d.esperarA(() => d.boton('Volver a llamar')));
  },
  async iniciar(d, u) {
    await d.pulsar(await d.esperarA(() => d.boton(u.boton)));
  },
  async triaje(d, u) {
    await d.esperarA(() => d.campo('PA (mmHg)'));
    for (const [k, etiqueta] of VITALES) await d.escribir(d.campo(etiqueta), u.vitals[k]);
    await d.escribir(d.campo('Motivo de consulta'), u.motivo);
    const alerta = d.raiz.querySelector('.ws-panel .msg.crit, .ws-panel .msg.warn, .ws-panel .msg.ok');
    if (alerta) await d.nota(alerta, 'La prioridad la calcula el sistema con los umbrales', 2600);
    await d.pulsar(await d.esperarA(() => d.boton('Finalizar triaje')));
  },
  async cita(d) {
    await d.esperarA(() => d.boton('Confirmar cita'), 8000);
    const cupo = d.raiz.querySelector('.cupo[aria-pressed="true"]');
    if (cupo) await d.nota(cupo, 'Cupo propuesto por el sistema', 2400);
    await d.pulsar(d.boton('Confirmar cita'));
  },
  async consulta(d, u) {
    await d.escribir(await d.esperarA(() => d.campo('Anamnesis')), u.notas);
    const dxCampo = d.campo('Diagnóstico (CIE-10)');
    for (const code of u.dx) {
      if ([...d.raiz.querySelectorAll('.chips .chip')].some((c) => texto(c).includes(code))) continue;
      await d.escribir(dxCampo, code);
      const opcion = await d.esperarA(() => [...d.raiz.querySelectorAll('[role="option"]')].find((o) => texto(o).includes(code)));
      await d.mover(opcion);
      d.ui.clic();
      opcion.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await d.ctl.espera(400);
    }
    // Receta: una fila por medicamento (se reutilizan las filas que ya estaban)
    for (const [n, x] of u.meds.entries()) {
      let fila = d.raiz.querySelectorAll('.medrow')[n];
      if (!fila) {
        await d.pulsar(d.boton('Agregar medicamento'));
        fila = await d.esperarA(() => d.raiz.querySelectorAll('.medrow')[n]);
      }
      const [nom, dosis, frec, dias] = fila.querySelectorAll('input');
      await d.escribir(nom, x.n);
      await d.escribir(dosis, x.dosis);
      await d.escribir(frec, x.frec);
      await d.escribir(dias, x.dias);
    }
    const sobran = [...d.raiz.querySelectorAll('.medrow')].slice(Math.max(u.meds.length, 1));
    for (const fila of sobran.reverse()) await d.pulsar(fila.querySelector('button'));
    if (allergyConflicts(d.alergia, u.meds.map((x) => x.n)).length) {
      const aviso = await d.esperarA(() => d.raiz.querySelector('.msg.crit input[type="checkbox"]')?.closest('.msg'));
      await d.nota(aviso, 'El sistema cruza la receta con la alergia registrada', 3200);
    }
    const destino = [...d.raiz.querySelectorAll('.dest-opt')].find((l) => texto(l).includes(u.dest));
    if (destino && !destino.classList.contains('on')) await d.pulsar(destino);
    if (u.destx) {
      const campo = await d.esperarA(() => d.campo('Días de reposo') || d.campo('Establecimiento de destino'));
      await d.escribir(campo, u.destx);
    }
    await d.pulsar(await d.esperarA(() => d.boton('Finalizar atención')));
  },
  async noShow(d) {
    await d.pulsar(await d.esperarA(() => d.boton('No se presentó')));
    const dlg = await d.esperarA(() => document.querySelector('.dialog[role="dialog"]'));
    await d.pulsar(await d.esperarA(() => d.boton('Cerrar turno', dlg)));
  },
};

/** Ejecuta el guion del paso (si tiene). Devuelve false si se rindió por no encontrar algo en pantalla. */
export async function actuar(app, ctl, ui, f, extra) {
  const u = f.paso.ui;
  const g = u && GUIONES[u.tipo];
  if (!g) return true;
  // Solo el contenido de la estación: la barra superior también tiene botones (por ejemplo, «Buscar o ir a…»)
  const raiz = app.querySelector('#contenido') || app;
  const d = { ...crearDriver(raiz, ctl, ui), raiz, ctl, ui, ...extra };
  try {
    await g(d, u, f);
    return true;
  } catch (e) {
    if (e === ABORTAR || e === SALTAR) throw e;
    console.warn(`Simulación en vivo: ${f.paso.titulo}:`, e.message);
    return false;
  }
}

