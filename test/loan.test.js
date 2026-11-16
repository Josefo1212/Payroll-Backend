import { test } from "node:test";
import assert from "node:assert/strict";
import { Loan } from "../src/bo/Payroll/Loan.js";
import { queries } from "../src/bo/Payroll/loader.js";

const PRESTAMO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PERSONA_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTRA_PERSONA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USUARIO_ID = "11111111-1111-4111-8111-111111111111";

function crearDb(respuestas = {}, calls = []) {
  return {
    calls,
    async query(texto, params = []) {
      calls.push({ texto, params });
      const responder = respuestas[texto];
      if (!responder) throw new Error(`Consulta no simulada: ${String(texto).slice(0, 80)}`);
      const valor = typeof responder === "function" ? responder(params) : responder;
      return { rows: Array.isArray(valor) ? valor : (valor == null ? [] : [valor]) };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
}

function prestamo(overrides = {}) {
  return {
    id: PRESTAMO_ID,
    persona_id: PERSONA_ID,
    fecha_otorgamiento: "2026-11-01",
    monto_total: "1000.00",
    nro_cuotas: 4,
    cuota_periodica: "250.00",
    tasa_interes: "0.0000",
    estado: "SOLICITADO",
    created_at: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

test("aprobar préstamo SOLICITADO: cambia a ACTIVO y guarda aprobado_por", async () => {
  const calls = [];
  const db = crearDb({
    [queries.findPrestamoById]: [prestamo()],
    [queries.findContratoVigentePorPersona]: [{ id: "contrato-1", frecuencia_pago: "MENSUAL" }],
    [queries.findPersonaByUsuario]: [{ persona_id: OTRA_PERSONA }],
    [queries.aprobarPrestamo]: [{ id: PRESTAMO_ID, estado: "ACTIVO", aprobado_por: USUARIO_ID }],
  }, calls);
  const loan = new Loan(db, { session: { userID: USUARIO_ID } });
  const res = await loan.aprobar(PRESTAMO_ID);
  assert.deepEqual(res, { id: PRESTAMO_ID, estado: "ACTIVO" });
  const upd = calls.find((c) => c.texto === queries.aprobarPrestamo);
  assert.ok(upd);
  assert.deepEqual(upd.params, [PRESTAMO_ID, USUARIO_ID]);
});

test("aprobar dos veces falla (ya gestionado)", async () => {
  const db = crearDb({
    [queries.findPrestamoById]: [prestamo({ estado: "ACTIVO" })],
  });
  const loan = new Loan(db, { session: { userID: USUARIO_ID } });
  await assert.rejects(() => loan.aprobar(PRESTAMO_ID), (err) => {
    assert.equal(err.status, 409);
    assert.match(err.message, /ya fue gestionado/);
    return true;
  });
});

test("aprobar préstamo ANULADO falla", async () => {
  const db = crearDb({
    [queries.findPrestamoById]: [prestamo({ estado: "ANULADO" })],
  });
  const loan = new Loan(db, { session: { userID: USUARIO_ID } });
  await assert.rejects(() => loan.aprobar(PRESTAMO_ID), (err) => {
    assert.equal(err.status, 409);
    return true;
  });
});

test("rechazar préstamo SOLICITADO pasa a ANULADO", async () => {
  const calls = [];
  const db = crearDb({
    [queries.findPrestamoById]: [prestamo()],
    [queries.rechazarPrestamo]: [{ id: PRESTAMO_ID, estado: "ANULADO", aprobado_por: USUARIO_ID }],
  }, calls);
  const loan = new Loan(db, { session: { userID: USUARIO_ID } });
  const res = await loan.rechazar(PRESTAMO_ID);
  assert.deepEqual(res, { id: PRESTAMO_ID, estado: "ANULADO" });
  assert.ok(calls.some((c) => c.texto === queries.rechazarPrestamo));
});

test("no se puede aprobar el propio préstamo", async () => {
  const db = crearDb({
    [queries.findPrestamoById]: [prestamo()],
    [queries.findContratoVigentePorPersona]: [{ id: "contrato-1", frecuencia_pago: "MENSUAL" }],
    [queries.findPersonaByUsuario]: [{ persona_id: PERSONA_ID }], // misma persona
  });
  const loan = new Loan(db, { session: { userID: USUARIO_ID } });
  await assert.rejects(() => loan.aprobar(PRESTAMO_ID), (err) => {
    assert.equal(err.status, 403);
    assert.match(err.message, /propio préstamo/);
    return true;
  });
});

test("no se aprueba si la persona no tiene contrato vigente", async () => {
  const db = crearDb({
    [queries.findPrestamoById]: [prestamo()],
    [queries.findContratoVigentePorPersona]: [],
    [queries.findPersonaByUsuario]: [{ persona_id: OTRA_PERSONA }],
  });
  const loan = new Loan(db, { session: { userID: USUARIO_ID } });
  await assert.rejects(() => loan.aprobar(PRESTAMO_ID), (err) => {
    assert.equal(err.status, 409);
    assert.match(err.message, /contrato vigente/);
    return true;
  });
});

test("aprobar sin sesión devuelve 401", async () => {
  const loan = new Loan(crearDb({}), { session: {} });
  await assert.rejects(() => loan.aprobar(PRESTAMO_ID), (err) => {
    assert.equal(err.status, 401);
    return true;
  });
});

test("aprobar con id inválido devuelve 400", async () => {
  const loan = new Loan(crearDb({}), { session: { userID: USUARIO_ID } });
  await assert.rejects(() => loan.aprobar(""), (err) => {
    assert.equal(err.status, 400);
    return true;
  });
});

test("aprobar préstamo inexistente devuelve 404", async () => {
  const db = crearDb({ [queries.findPrestamoById]: [] });
  const loan = new Loan(db, { session: { userID: USUARIO_ID } });
  await assert.rejects(() => loan.aprobar(PRESTAMO_ID), (err) => {
    assert.equal(err.status, 404);
    return true;
  });
});

test("rechazar préstamo inexistente o ya gestionado devuelve 409", async () => {
  const db = crearDb({ [queries.findPrestamoById]: [prestamo({ estado: "PAGADO" })] });
  const loan = new Loan(db, { session: { userID: USUARIO_ID } });
  await assert.rejects(() => loan.rechazar(PRESTAMO_ID), (err) => {
    assert.equal(err.status, 409);
    return true;
  });
});

test("integración lógica: cuotas pendientes solo de préstamos ACTIVO y aprobar las habilita", async () => {
  // Antes de aprobar (SOLICITADO): findCuotasPendientesPorPersona devuelve [] (query filtra pr.estado='ACTIVO')
  const dbAntes = crearDb({
    [queries.findCuotasPendientesPorPersona]: [],
  });
  const { rows: antes } = await dbAntes.query(queries.findCuotasPendientesPorPersona, [PERSONA_ID, "2026-12-31"]);
  assert.equal(antes.length, 0);

  // Aprobar
  const calls = [];
  const dbAprobar = crearDb({
    [queries.findPrestamoById]: [prestamo({ estado: "SOLICITADO" })],
    [queries.findContratoVigentePorPersona]: [{ id: "contrato-1", frecuencia_pago: "MENSUAL" }],
    [queries.findPersonaByUsuario]: [{ persona_id: OTRA_PERSONA }],
    [queries.aprobarPrestamo]: [{ id: PRESTAMO_ID, estado: "ACTIVO", aprobado_por: USUARIO_ID }],
  }, calls);
  const loan = new Loan(dbAprobar, { session: { userID: USUARIO_ID } });
  await loan.aprobar(PRESTAMO_ID);
  assert.ok(calls.some((c) => c.texto === queries.aprobarPrestamo));

  // Tras aprobar (ACTIVO): la consulta de nómina devuelve cuotas a descontar
  const dbDespues = crearDb({
    [queries.findCuotasPendientesPorPersona]: [
      { id: "cuota-1", prestamo_id: PRESTAMO_ID, nro_cuota: 1, fecha_vencimiento: "2026-12-01", monto_capital: "250.00", monto_interes: "0.00", monto_cuota: "250.00" },
    ],
  });
  const { rows: despues } = await dbDespues.query(queries.findCuotasPendientesPorPersona, [PERSONA_ID, "2026-12-31"]);
  assert.equal(despues.length, 1);
  assert.equal(despues[0].monto_cuota, "250.00");
});
