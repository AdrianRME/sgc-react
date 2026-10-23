/*
 * Prueba de estrés (RNF-01): sube de 10 a 30 usuarios virtuales en escalones de 5, un minuto
 * cada uno. Cada usuario es una estación que recarga sus datos (sgc_cargar) cada segundo; las
 * de Admisión además registran pacientes ficticios, y las pantallas de sala consultan sgc_sala().
 * Sirve para ver desde cuántas estaciones el percentil 95 supera 1,5 s.
 * Uso: k6 run -e API=... -e TOKENS=tokens.json estres.js
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import exec from 'k6/execution';

const API = __ENV.API || 'http://127.0.0.1:18080';
const TOKENS = JSON.parse(open(__ENV.TOKENS || './tokens.json'));
const rpcTime = new Trend('rpc_ms', true);
const errores = new Counter('errores_inesperados');
const rechazos = new Counter('rechazos_de_regla');

const CUENTAS = ['a.admision', 'e.triaje', 'm.consulta', 'm.consulta2', 'j.jefatura', 'anon', 'c.caja', 'm.pediatria', 'm.cardio', 'anon'];

export const options = {
  scenarios: {
    estres: {
      executor: 'ramping-vus', startVUs: 10,
      stages: [
        { duration: '1m', target: 10 }, { duration: '5s', target: 15 }, { duration: '1m', target: 15 },
        { duration: '5s', target: 20 }, { duration: '1m', target: 20 }, { duration: '5s', target: 25 },
        { duration: '1m', target: 25 }, { duration: '5s', target: 30 }, { duration: '1m', target: 30 },
      ],
    },
  },
  // Los umbrales crean una submétrica por escalón y por función en el resumen exportado
  thresholds: Object.fromEntries([
    ...['10', '15', '20', '25', '30'].map((v) => [`rpc_ms{vus:${v}}`, ['p(95)<1500']]),
    ...['sgc_cargar', 'sgc_guardar', 'sgc_sala'].map((f) => [`rpc_ms{fn:${f}}`, ['p(95)<1500']]),
    ['errores_inesperados', ['count==0']],
  ]),
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max', 'count'],
};

function etapa() {
  const s = exec.instance.currentTestRunDuration / 1000;
  if (s < 62) return '10';
  if (s < 127) return '15';
  if (s < 192) return '20';
  if (s < 257) return '25';
  return '30';
}

function rpc(user, fn, body) {
  const res = http.post(`${API}/rpc/${fn}`, JSON.stringify(body || {}), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS[user]}` }, tags: { fn },
  });
  rpcTime.add(res.timings.duration, { fn, vus: etapa() });
  if (res.status >= 500 || res.status === 0) errores.add(1);
  else if (res.status >= 400) rechazos.add(1);
  return res;
}

export default function () {
  const user = CUENTAS[(exec.vu.idInTest - 1) % CUENTAS.length];
  if (user === 'anon') { rpc(user, 'sgc_sala'); sleep(3); return; }
  rpc(user, 'sgc_cargar');
  if (user === 'a.admision' && exec.vu.iterationInScenario % 5 === 0) {
    const dni = String(60000000 + Math.floor(Math.random() * 9999999));
    const n = exec.vu.idInTest * 10000 + exec.vu.iterationInScenario;
    rpc(user, 'sgc_guardar', { cambios: {
      patients: [{ dni, nom: 'Paciente', ape: 'Estrés', nac: '1992-03-03', sexo: 'M', tel: '', sis: 'ACTIVO', hc: `HC-${String(500000 + n).padStart(6, '0')}`, ant: '', alg: '' }],
      turns: [{ id: `TR-${String(n % 100000).padStart(5, '0')}`, dni, state: 'EN_ESPERA_TRIAJE' }] } });
  }
  sleep(1);
}
