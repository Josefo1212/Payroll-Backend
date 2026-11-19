import { test } from "node:test";
import assert from "node:assert/strict";
import { Receipt } from "../src/bo/Payroll/Receipt.js";
import { reciboPdfService } from "../src/services/ReciboPdfService.js";
import { queries } from "../src/bo/Payroll/loader.js";
import { ErrorNegocio } from "../src/errors/ErrorNegocio.js";
import { crearReq } from "./helpers.js";

const RECIBO_ID = "55555555-5555-4555-8555-555555555555";
const PERSONA_ID = "22222222-2222-4222-8222-222222222222";
const OTRA_PERSONA_ID = "66666666-6666-4666-8666-666666666666";

const RECIBO = {
  id: RECIBO_ID,
  persona_id: PERSONA_ID,
  periodo_nomina_id: "33333333-3333-4333-8333-333333333333",
  contrato_id: "44444444-4444-4444-8444-444444444444",
  fecha_emision: "2026-11-16",
  total_asignaciones: "1725.00",
  total_deducciones: "259.89",
  monto_total: "1465.11",
  estado: "PAGADO",
  fecha_pago: "2026-11-17",
  metodo_pago: "TRANSFERENCIA",
  referencia_pago: "REF-001",
  cuenta_bancaria_id: null,
  pagado_por: null,
  cedula: "V-12345678",
  primer_nombre: "Luis",
  primer_apellido: "Gómez",
  fecha_inicio: "2026-11-09",
  fecha_fin: "2026-11-15",
  frecuencia: "SEMANAL",
};

const DETALLE = [
  {
    tipo_concepto: "ASIGNACION",
    nombre_concepto: "Sueldo base",
    cantidad_unidades: "40",
    monto: "1200.00",
  },
  {
    tipo_concepto: "ASIGNACION",
    nombre_concepto: "Bono puntual",
    cantidad_unidades: null,
    monto: "525.00",
  },
  {
    tipo_concepto: "DEDUCCION",
    nombre_concepto: "Seguro social",
    cantidad_unidades: null,
    monto: "259.89",
  },
  {
    tipo_concepto: "APORTE_PATRONAL",
    nombre_concepto: "Seguro social patronal",
    cantidad_unidades: null,
    monto: "224.25",
  },
];

function crearDb({ recibo = RECIBO, detalle = DETALLE, personaId = PERSONA_ID } = {}) {
  const llamadas = [];
  const db = {
    llamadas,
    query: async (texto, params = []) => {
      llamadas.push({ texto, params });
      if (texto === queries.findReciboPorId) {
        return { rows: recibo ? [recibo] : [] };
      }
      if (texto === queries.findDetallePorRecibo) {
        return { rows: detalle };
      }
      if (texto === queries.findPersonaByUsuario) {
        return { rows: [{ persona_id: personaId }] };
      }
      throw new Error(`Consulta no simulada: ${texto}`);
    },
  };
  return db;
}

test("el servicio genera un PDF con cabecera %PDF y nombre de archivo saneado", async () => {
  const contenido = await reciboPdfService.generar(RECIBO, DETALLE);

  assert.ok(Buffer.isBuffer(contenido));
  assert.ok(contenido.length > 500);
  assert.equal(contenido.subarray(0, 4).toString("latin1"), "%PDF");
  assert.equal(
    reciboPdfService.nombreArchivo({ ...RECIBO, cedula: "V-12.345.678" }),
    "recibo-V-12345678-2026-11-09.pdf",
  );
});

test("el servicio acepta fechas Date y un recibo sin detalle", async () => {
  const contenido = await reciboPdfService.generar(
    {
      ...RECIBO,
      fecha_inicio: new Date(2026, 10, 9),
      fecha_fin: new Date(2026, 10, 15),
      fecha_emision: new Date(2026, 10, 16, 9, 30),
    },
    [],
  );

  assert.equal(contenido.subarray(0, 4).toString("latin1"), "%PDF");
  assert.equal(
    reciboPdfService.nombreArchivo({
      ...RECIBO,
      fecha_inicio: new Date(2026, 10, 9),
    }),
    "recibo-V-12345678-2026-11-09.pdf",
  );
});

test("un gestor descarga el PDF de cualquier recibo", async () => {
  const db = crearDb();
  const req = crearReq({
    userID: "u-1",
    detallesPerfiles: [{ id: 1, nombre: "RRHH" }],
  });

  const receipt = new Receipt(db, req);
  const resultado = await receipt.generarPdf(RECIBO_ID);

  assert.equal(resultado.mimeType, "application/pdf");
  assert.equal(resultado.nombreArchivo, "recibo-V-12345678-2026-11-09.pdf");
  assert.ok(resultado.tamanioBytes > 500);
  assert.equal(
    Buffer.from(resultado.contenidoBase64, "base64").subarray(0, 4).toString("latin1"),
    "%PDF",
  );
  assert.ok(
    !db.llamadas.some((llamada) => llamada.texto === queries.findPersonaByUsuario),
    "el gestor no necesita resolver la persona de la sesión",
  );
});

test("un empleado descarga su propio recibo", async () => {
  const db = crearDb();
  const req = crearReq({
    userID: "u-2",
    detallesPerfiles: [{ id: 2, nombre: "Empleado" }],
  });

  const resultado = await new Receipt(db, req).generarPdf(RECIBO_ID);
  assert.equal(resultado.mimeType, "application/pdf");
});

test("un empleado no descarga el recibo de otra persona", async () => {
  const db = crearDb({ personaId: OTRA_PERSONA_ID });
  const req = crearReq({
    userID: "u-3",
    detallesPerfiles: [{ id: 2, nombre: "Empleado" }],
  });

  await assert.rejects(
    () => new Receipt(db, req).generarPdf(RECIBO_ID),
    (error) =>
      error instanceof ErrorNegocio &&
      error.status === 403 &&
      /No autorizado/.test(error.message),
  );
});

test("generarPdf exige recibo_id y recibo existente", async () => {
  const receipt = new Receipt(crearDb(), crearReq({ userID: "u-1" }));

  await assert.rejects(
    () => receipt.generarPdf("  "),
    (error) =>
      error instanceof ErrorNegocio &&
      error.status === 400 &&
      /recibo_id/.test(error.message),
  );

  const sinFila = new Receipt(crearDb({ recibo: null }), crearReq({ userID: "u-1" }));
  await assert.rejects(
    () => sinFila.generarPdf(RECIBO_ID),
    (error) =>
      error instanceof ErrorNegocio &&
      error.status === 404 &&
      /no existe/.test(error.message),
  );
});
