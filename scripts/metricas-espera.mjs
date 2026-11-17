/**
 * Exactitud de la espera aproximada (RF-14), repetible en cualquier equipo:  npm run metricas:espera
 * Fija la hora de Lima (las jornadas simuladas dependen del horario de atención) y ejecuta la validación de
 * pruebas-carga/validar-espera.mjs: 18 jornadas simuladas, 250 estimaciones por etapa.
 * La métrica de las diapositivas es la última columna: estimaciones con |error| ≤ 5 min.
 */
process.env.TZ = 'America/Lima';
await import('../pruebas-carga/validar-espera.mjs');
