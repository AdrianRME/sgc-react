/*
 * Prueba de concurrencia (RNF-09): dos estaciones envían a la vez operaciones que chocan.
 * Por cada caso, exactamente una debe guardarse y la otra debe ser rechazada por la base,
 * sin dejar datos duplicados ni a medias. Se repite 20 veces cada caso:
 *   A. Dos cajas cobran el mismo turno.
 *   B. Dos admisiones generan el mismo código de turno para pacientes distintos.
 *   C. Triaje inicia dos pacientes a la vez en el único módulo de triaje.
 * Datos ficticios. Uso: k6 run -e API=... -e TOKENS=tokens.json concurrencia.js
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import exec from 'k6/execution';

const API = __ENV.API || 'http://127.0.0.1:18080';
const TOKENS = JSON.parse(open(__ENV.TOKENS || './tokens.json'));
const N = 20;
const SLOT_MS = 1500;

const ganadas = new Counter('carreras_ganadas');
const rechazadas = new Counter('carreras_rechazadas');
const otros = new Counter('respuestas_inesperadas');

export const options = {
  scenarios: {
    caja: { executor: 'per-vu-iterations', vus: 2, iterations: 1, exec: 'caja', startTime: '0s', maxDuration: '2m' },
    admision: { executor: 'per-vu-iterations', vus: 2, iterations: 1, exec: 'admision', startTime: '45s', maxDuration: '2m' },
    triaje: { executor: 'per-vu-iterations', vus: 2, iterations: 1, exec: 'triaje', startTime: '90s', maxDuration: '2m' },
  },
};

function rpc(user, fn, body, caso) {
  const res = http.post(`${API}/rpc/${fn}`, JSON.stringify(body || {}), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS[user]}` }, tags: { fn, caso },
  });
  return res;
}
const pad = (n, w) => String(n).padStart(w, '0');
const guardar = (user, cambios, caso) => rpc(user, 'sgc_guardar', { cambios }, caso);

function paciente(dni, sis, i) {
  return { dni, nom: 'Paciente', ape: `Concurrencia ${i}`, nac: '1990-01-01', sexo: 'F', tel: '', sis, hc: `HC-${dni.slice(2)}`, ant: '', alg: '' };
}

export function setup() {
  const base = 7100 + Math.floor(Math.random() * 800);
  // A: 20 turnos sin seguro esperando pago
  for (let i = 0; i < N; i++) {
    const dni = `${base}${pad(i, 4)}`;
    guardar('a.admision', { patients: [paciente(dni, 'NO_ASEGURADO', i)], turns: [{ id: `TR-${600 + i}`, dni, state: 'PENDIENTE_PAGO' }] }, 'preparacion');
  }
  // C: 40 turnos con SIS llamados a triaje (se iniciarán de dos en dos)
  for (let i = 0; i < 2 * N; i++) {
    const dni = `${base}${pad(5000 + i, 4)}`;
    guardar('a.admision', { patients: [paciente(dni, 'ACTIVO', i)], turns: [{ id: `TR-${700 + i}`, dni, state: 'EN_ESPERA_TRIAJE' }] }, 'preparacion');
  }
  return { base, t0: Date.now() + 3000 };
}

const turnoPago = (data, i) => ({ id: `TR-${600 + i}`, dni: `${data.base}${pad(i, 4)}` });
const turnoTri = (data, i) => ({ id: `TR-${700 + i}`, dni: `${data.base}${pad(5000 + i, 4)}` });

function contar(res) {
  if (res.status === 204 || res.status === 200) { ganadas.add(1); return true; }
  if (res.status === 400 || res.status === 409 || res.status === 403) { rechazadas.add(1); return false; }
  otros.add(1); return false;
}

function esperar(t) { const d = t - Date.now(); if (d > 0) sleep(d / 1000); }

export function caja(data) {
  const vu = exec.vu.idInTest;   // dos cajas distintas (misma cuenta en dos PC)
  for (let i = 0; i < N; i++) {
    esperar(data.t0 + i * SLOT_MS);
    const t = turnoPago(data, i);
    contar(guardar('c.caja', { turns: [{ ...t, state: 'EN_ESPERA_TRIAJE', pago: { metodo: 'EFECTIVO', monto: 20, comp: `B001-${pad(900000 + i * 2 + vu, 6)}` } }] }, 'A_doble_cobro'));
  }
}

export function admision(data) {
  const vu = exec.vu.idInTest;
  const t0 = data.t0 + 45000;
  for (let i = 0; i < N; i++) {
    esperar(t0 + i * SLOT_MS);
    const dni = `${data.base}${pad(3000 + i * 2 + (vu % 2), 4)}`;
    contar(guardar('a.admision', { patients: [paciente(dni, 'ACTIVO', i)], turns: [{ id: `TR-${800 + i}`, dni, state: 'EN_ESPERA_TRIAJE' }] }, 'B_codigo_repetido'));
  }
}

export function triaje(data) {
  const vu = exec.vu.idInTest % 2;
  const t0 = data.t0 + 90000;
  for (let i = 0; i < N; i++) {
    // cada estación llama primero a su paciente; luego ambas intentan iniciarlo en el mismo instante
    const t = turnoTri(data, 2 * i + vu);
    esperar(t0 + i * SLOT_MS * 2);
    guardar('e.triaje', { turns: [{ ...t, state: 'LLAMADO_TRIAJE', dest: 'Módulo de Triaje 1' }] }, 'preparacion');
    esperar(t0 + i * SLOT_MS * 2 + 700);
    const ok = contar(guardar('e.triaje', { turns: [{ ...t, state: 'EN_TRIAJE' }] }, 'C_triaje_ocupado'));
    esperar(t0 + i * SLOT_MS * 2 + 1400);
    if (ok) guardar('e.triaje', { turns: [{ ...t, state: 'EN_ESPERA_TRIAJE' }] }, 'preparacion');   // libera el módulo
  }
}
