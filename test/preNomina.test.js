import { test } from "node:test";
import assert from "node:assert/strict";
import { PreNomina } from "../src/bo/Payroll/PreNomina.js";
import { queries } from "../src/bo/Payroll/loader.js";
import { ErrorNegocio } from "../src/errors/ErrorNegocio.js";
import { crearReq } from "./helpers.js";

const USUARIO_ID = "11111111-1111-4111-8111-111111111111";
const PERSONA_ID = "22222222-2222-4222-8222-222222222222";
const PERIODO_ID = "33333333-3333-4333-8333-333333333333";
const CONTRATO_ID = "44444444-4444-4444-8444-444444444444";
const PRE_NOMINA_ID = "55555555-5555-4555-8555-555555555555";
const RECIBO_ID = "66666666-6666-4666-8666-666666666666";
const OTRO_RECIBO_ID = "77777777-7777-4777-8777-777777777777";
const LINEA_ID = "88888888-8888-4888-8888-888888888888";

const CONCEPTOS = [
  {
    id: 1,
    codigo: "SUELDO_BASE",
    nombre_concepto: "Sueldo base",
    tipo_concepto: "ASIGNACION",
    categoria: "AJUSTE",
    unidad: "MONTO",
    afecta_base_ley: true,
    activo: true,
  },
  {
    id: 2,
    codigo: "HORA_EXTRA",
    nombre_concepto: "Hora extra",
    tipo_concepto: "ASIGNACION",
    categoria: "HORA_EXTRA",
    unidad: "HORA",
    afecta_base_ley: true,
    activo: true,
  },
  {
    id: 3,
    codigo: "CUOTA_PRESTAMO",
    nombre_concepto: "Cuota de préstamo",
    tipo_concepto: "DEDUCCION",
    categoria: "PRESTAMO",
    unidad: "MONTO",
    afecta_base_ley: false,
    activo: true,
  },
  {
    id: 4,
    codigo: "SSO",
    nombre_concepto: "Seguro social",
    tipo_concepto: "DEDUCCION",
    categoria: "LEY",
    unidad: "MONTO",
    afecta_base_ley: false,
    activo: true,
  },
  {
    id: 5,
    codigo: "SSO_PATRONAL",
    nombre_concepto: "Seguro social patronal",
    tipo_concepto: "APORTE_PATRONAL",
    categoria: "LEY",
    unidad: "MONTO",
    afecta_base_ley: false,
    activo: true,
  },
  {
    id: 6,
    codigo: "BONO_MANUAL",
    nombre_concepto: "Bono manual",
    tipo_concepto: "ASIGNACION",
    categoria: "BONO",
    unidad: "MONTO",
    afecta_base_ley: false,
    activo: true,
  },
  {
    id: 7,
    codigo: "INACTIVO",
    nombre_concepto: "Concepto inactivo",
    tipo_concepto: "ASIGNACION",
    categoria: "OPCIONAL",
    unidad: "MONTO",
    afecta_base_ley: false,
    activo: false,
  },
  {
    id: 8,
    codigo: "EXTRA_MANUAL",
    nombre_concepto: "Hora extra manual",
    tipo_concepto: "ASIGNACION",
    categoria: "HORA_EXTRA",
    unidad: "MONTO",
    afecta_base_ley: true,
    activo: true,
  },
  {
    id: 9,
    codigo: "BONO_NOVEDAD",
    nombre_concepto: "Bono por novedad",
    tipo_concepto: "ASIGNACION",
    categoria: "BONO",
    unidad: "MONTO",
    afecta_base_ley: false,
    activo: true,
  },
  {
    id: 10,
    codigo: "BONO_EXTRA",
    nombre_concepto: "Bono extra",
    tipo_concepto: "ASIGNACION",
    categoria: "BONO",
    unidad: "MONTO",
    afecta_base_ley: false,
    activo: true,
  },
];

const POR_CODIGO = new Map(CONCEPTOS.map((concepto) => [concepto.codigo, concepto]));
const POR_ID = new Map(CONCEPTOS.map((concepto) => [concepto.id, concepto]));

const PERIODO = {
  id: PERIODO_ID,
  fecha_inicio: "2031-01-01",
  fecha_fin: "2031-01-07",
  frecuencia: "SEMANAL",
  estado: "BORRADOR",
  descripcion: "Semana de prueba",
};

const CONTRATO = {
  contrato_id: CONTRATO_ID,
  persona_id: PERSONA_ID,
  tipo_pago: "POR_HORA",
  frecuencia_pago: "SEMANAL",
  primer_nombre: "Ana",
  primer_apellido: "Pérez",
  monto_salario: "10",
};

const cabeceraBorrador = (extra = {}) => ({
  id: PRE_NOMINA_ID,
  periodo_nomina_id: PERIODO_ID,
  version: 1,
  generado_por: USUARIO_ID,
  fecha_generacion: "2031-01-01T10:00:00.000Z",
  actualizado_por: null,
  fecha_actualizacion: null,
  fecha_inicio: PERIODO.fecha_inicio,
  fecha_fin: PERIODO.fecha_fin,
  frecuencia: PERIODO.frecuencia,
  periodo_estado: "BORRADOR",
  periodo_descripcion: PERIODO.descripcion,
  ...extra,
});

const filaDetalle = ({
  id,
  reciboId,
  conceptoId,
  origen,
  monto,
  baseCalculo = null,
  tasaAplicada = null,
  cantidadUnidades = null,
  editada = false,
  cuotaPrestamoId = null,
  novedadId = null,
  conceptoPersonaId = null,
  parametroAporteId = null,
}) => {
  const concepto = POR_ID.get(conceptoId);
  return {
    id,
    pre_nomina_recibo_id: reciboId,
    concepto_id: conceptoId,
    origen,
    cuota_prestamo_id: cuotaPrestamoId,
    novedad_id: novedadId,
    concepto_persona_id: conceptoPersonaId,
    parametro_aporte_id: parametroAporteId,
    base_calculo: baseCalculo,
    tasa_aplicada: tasaAplicada,
    cantidad_unidades: cantidadUnidades,
    monto,
    editada,
    codigo: concepto.codigo,
    nombre_concepto: concepto.nombre_concepto,
    tipo_concepto: concepto.tipo_concepto,
    categoria: concepto.categoria,
    unidad: concepto.unidad,
    afecta_base_ley: concepto.afecta_base_ley,
  };
};

// Base falsa con estado: guarda lo que se inserta para que `#cargarBorrador`
// devuelva exactamente lo recién escrito, igual que PostgreSQL.
function crearDb({
  periodo = PERIODO,
  borrador = null,
  recibos = [],
  detalles = [],
  contratos = [],
  horas = { horas_normales: "0", horas_extra: "0" },
  recurrentes = [],
  novedades = [],
  cuotas = [],
  afiliaciones = [],
  parametros = [],
  errorInsertPreNomina = null,
} = {}) {
  const llamadas = [];
  const estado = { borrador, recibos: [...recibos], detalles: [...detalles] };
  let secuencia = 0;

  const db = {
    llamadas,
    estado,
    transaction: async (fn) => fn(db),
    query: async (texto, params = []) => {
      llamadas.push({ texto, params });

      if (texto === queries.findPeriodoById || texto === queries.findPeriodoByIdForUpdate) {
        return { rows: periodo ? [periodo] : [] };
      }
      if (texto === queries.findPreNominaByPeriodo) {
        return { rows: estado.borrador ? [{ id: estado.borrador.id, version: estado.borrador.version }] : [] };
      }
      if (texto === queries.findPreNominaById || texto === queries.findPreNominaByIdForUpdate) {
        return { rows: estado.borrador ? [estado.borrador] : [] };
      }
      if (texto === queries.findConceptoByCodigo) {
        const concepto = POR_CODIGO.get(params[0]);
        return { rows: concepto ? [concepto] : [] };
      }
      if (texto === queries.findConceptoById) {
        const concepto = POR_ID.get(params[0]);
        return { rows: concepto ? [concepto] : [] };
      }
      if (texto === queries.findContratosVigentesPorFrecuencia) {
        return { rows: contratos };
      }
      if (texto === queries.sumaHorasPorPersonaPeriodo) {
        return { rows: [horas] };
      }
      if (texto === queries.findRecurrentesVigentesPorPersona) {
        return { rows: recurrentes };
      }
      if (texto === queries.findNovedadesAprobadasPorPersona) {
        return { rows: novedades };
      }
      if (texto === queries.findCuotasPendientesPorPersona) {
        return { rows: cuotas };
      }
      if (texto === queries.findAfiliacionesVigentesPorPersona) {
        return { rows: afiliaciones };
      }
      if (texto === queries.findParametrosAportePorIds) {
        const ids = params[0] ?? [];
        return { rows: parametros.filter((fila) => ids.includes(fila.id)) };
      }
      if (texto === queries.insertPreNomina) {
        if (errorInsertPreNomina) {
          throw errorInsertPreNomina;
        }
        secuencia += 1;
        estado.borrador = cabeceraBorrador({
          id: `pre-${secuencia}`,
          periodo_nomina_id: params[0],
          generado_por: params[1],
        });
        return {
          rows: [
            {
              id: estado.borrador.id,
              periodo_nomina_id: params[0],
              version: 1,
            },
          ],
        };
      }
      if (texto === queries.insertPreNominaRecibo) {
        secuencia += 1;
        const fila = {
          id: `pre-recibo-${secuencia}`,
          pre_nomina_id: params[0],
          persona_id: params[1],
          contrato_id: params[2],
          total_asignaciones: params[3],
          total_deducciones: params[4],
          monto_total: params[5],
          cedula: "V-12345678",
          primer_nombre: CONTRATO.primer_nombre,
          primer_apellido: CONTRATO.primer_apellido,
        };
        estado.recibos.push(fila);
        return { rows: [fila] };
      }
      if (texto === queries.insertPreNominaDetalle) {
        secuencia += 1;
        const fila = filaDetalle({
          id: `detalle-${secuencia}`,
          reciboId: params[0],
          conceptoId: params[1],
          origen: params[2],
          cuotaPrestamoId: params[3],
          novedadId: params[4],
          conceptoPersonaId: params[5],
          parametroAporteId: params[6],
          baseCalculo: params[7],
          tasaAplicada: params[8],
          // node-pg devuelve numeric como texto con la escala de la columna.
          cantidadUnidades: params[9] == null ? null : Number(params[9]).toFixed(2),
          monto: params[10],
          editada: params[11],
        });
        estado.detalles.push(fila);
        return { rows: [{ id: fila.id }] };
      }
      if (texto === queries.findPreNominasRecibos) {
        return { rows: estado.recibos };
      }
      if (texto === queries.findPreNominaDetalle) {
        return { rows: estado.detalles };
      }
      if (texto === queries.deletePreNominaDetalleEditables) {
        const [reciboId, conservados] = params;
        const antes = estado.detalles.length;
        estado.detalles = estado.detalles.filter(
          (fila) =>
            !(
              fila.pre_nomina_recibo_id === reciboId &&
              ["CALCULADA", "MANUAL"].includes(fila.origen) &&
              !conservados.includes(fila.id)
            ),
        );
        return { rows: estado.detalles.slice(0, antes - estado.detalles.length) };
      }
      if (texto === queries.updatePreNominaDetalleMonto) {
        const fila = estado.detalles.find((detalle) => detalle.id === params[0]);
        if (fila) {
          fila.monto = params[1];
          fila.cantidad_unidades = params[2];
          fila.editada = params[3];
        }
        return { rows: fila ? [{ id: fila.id }] : [] };
      }
      if (texto === queries.updatePreNominaDetalleLey) {
        const fila = estado.detalles.find((detalle) => detalle.id === params[0]);
        if (fila) {
          fila.base_calculo = params[1];
          fila.monto = params[2];
        }
        return { rows: fila ? [{ id: fila.id }] : [] };
      }
      if (texto === queries.deletePreNominaDetalle) {
        estado.detalles = estado.detalles.filter((detalle) => detalle.id !== params[0]);
        return { rows: [{ id: params[0] }] };
      }
      if (texto === queries.updatePreNominaReciboTotales) {
        const recibo = estado.recibos.find((fila) => fila.id === params[0]);
        if (recibo) {
          recibo.total_asignaciones = params[1];
          recibo.total_deducciones = params[2];
          recibo.monto_total = params[3];
        }
        return { rows: recibo ? [{ id: recibo.id }] : [] };
      }
      if (texto === queries.touchPreNomina) {
        estado.borrador = {
          ...estado.borrador,
          version: estado.borrador.version + 1,
          actualizado_por: params[1],
          fecha_actualizacion: "2031-01-01T11:00:00.000Z",
        };
        return { rows: [{ version: estado.borrador.version }] };
      }

      throw new Error(`Consulta no simulada: ${texto}`);
    },
  };

  return db;
}

const reqConSesion = () => crearReq({ userID: USUARIO_ID });

const llamadasDe = (db, consulta) =>
  db.llamadas.filter((llamada) => llamada.texto === consulta);

const rechazaCon = async (promesa, status, fragmento) => {
  await assert.rejects(promesa, (error) => {
    assert.ok(error instanceof ErrorNegocio, `esperaba ErrorNegocio, llegó ${error?.name}`);
    assert.equal(error.status, status);
    if (fragmento) {
      assert.match(error.message, fragmento);
    }
    return true;
  });
};

// ---------------------------------------------------------------------------
// generar
// ---------------------------------------------------------------------------

test("generar sin sesión responde 401 sin tocar la base", async () => {
  const db = crearDb();
  const preNomina = new PreNomina(db, crearReq());

  await rechazaCon(preNomina.generar(PERIODO_ID), 401, /iniciar sesión/);
  assert.equal(db.llamadas.length, 0);
});

test("generar con UUID inválido responde 400", async () => {
  const db = crearDb();
  const preNomina = new PreNomina(db, reqConSesion());

  await rechazaCon(preNomina.generar("no-es-uuid"), 400, /UUID/);
  assert.equal(db.llamadas.length, 0);
});

test("generar sobre un período inexistente responde 404", async () => {
  const db = crearDb({ periodo: null });
  const preNomina = new PreNomina(db, reqConSesion());

  await rechazaCon(preNomina.generar(PERIODO_ID), 404, /período no existe/);
});

test("generar sobre un período PROCESADO responde 409", async () => {
  const db = crearDb({ periodo: { ...PERIODO, estado: "PROCESADO" } });
  const preNomina = new PreNomina(db, reqConSesion());

  await rechazaCon(preNomina.generar(PERIODO_ID), 409, /BORRADOR/);
});

test("generar con borrador existente responde 409", async () => {
  const db = crearDb({ borrador: cabeceraBorrador() });
  const preNomina = new PreNomina(db, reqConSesion());

  await rechazaCon(preNomina.generar(PERIODO_ID), 409, /ya tiene una pre-nómina/);
  assert.equal(llamadasDe(db, queries.insertPreNomina).length, 0);
});

test("generar traduce la carrera del UNIQUE a 409", async () => {
  const error = Object.assign(new Error("duplicate key"), { code: "23505" });
  const db = crearDb({ errorInsertPreNomina: error });
  const preNomina = new PreNomina(db, reqConSesion());

  await rechazaCon(preNomina.generar(PERIODO_ID), 409, /ya tiene una pre-nómina/);
});

test("generar crea el borrador con recibos, editable y totales como texto", async () => {
  const db = crearDb({
    contratos: [CONTRATO],
    horas: { horas_normales: "80", horas_extra: "10" },
    afiliaciones: [
      {
        parametro_id: 7,
        concepto_deduccion_id: 4,
        concepto_patronal_id: 5,
        tasa_empleado: "0.0400",
        tasa_patronal: "0.0900",
        piso_base: null,
        tope_base: null,
      },
    ],
  });
  const preNomina = new PreNomina(db, reqConSesion());

  const respuesta = await preNomina.generar(PERIODO_ID);

  assert.equal(respuesta.preNomina.periodoId, PERIODO_ID);
  assert.equal(respuesta.preNomina.version, 1);
  assert.equal(respuesta.preNomina.recibos, 1);
  assert.equal(respuesta.preNomina.totalAsignaciones, "950.00");
  assert.equal(respuesta.preNomina.totalDeducciones, "38.00");
  assert.equal(respuesta.preNomina.totalAportePatronal, "85.50");
  // El aporte patronal NO entra al neto.
  assert.equal(respuesta.preNomina.montoTotal, "912.00");

  const [recibo] = respuesta.recibos;
  assert.equal(recibo.personaId, PERSONA_ID);
  assert.equal(recibo.nombre, "Ana Pérez");
  assert.equal(recibo.montoTotal, "912.00");

  const porOrigen = (origen) => recibo.lineas.filter((linea) => linea.origen === origen);
  assert.equal(porOrigen("CALCULADA").length, 2);
  assert.equal(porOrigen("LEY").length, 2);
  assert.deepEqual(
    recibo.lineas.map((linea) => linea.editable),
    [true, true, false, false],
  );
  assert.equal(recibo.lineas[0].monto, "800.00");
  assert.equal(recibo.lineas[1].monto, "150.00");
  assert.equal(recibo.lineas[0].cantidadUnidades, "80.00");
});

test("generar no aplica novedades, cuotas, préstamos ni el período", async () => {
  const db = crearDb({ contratos: [CONTRATO], horas: { horas_normales: "80" } });
  const preNomina = new PreNomina(db, reqConSesion());

  await preNomina.generar(PERIODO_ID);

  const prohibidas = [
    queries.marcarNovedadesAplicadas,
    queries.marcarCuotaDescontada,
    queries.marcarPrestamosPagados,
    queries.updatePeriodoEstado,
  ];
  for (const consulta of prohibidas) {
    assert.equal(llamadasDe(db, consulta).length, 0, `no debe llamar ${consulta}`);
  }
});

// ---------------------------------------------------------------------------
// ver
// ---------------------------------------------------------------------------

test("ver sin sesión responde 401", async () => {
  const db = crearDb();
  const preNomina = new PreNomina(db, crearReq());

  await rechazaCon(preNomina.ver(PRE_NOMINA_ID), 401);
  assert.equal(db.llamadas.length, 0);
});

test("ver un borrador inexistente responde 404", async () => {
  const db = crearDb();
  const preNomina = new PreNomina(db, reqConSesion());

  await rechazaCon(preNomina.ver(PRE_NOMINA_ID), 404, /no existe/);
});

test("ver devuelve recibos, líneas y totalAportePatronal fuera del neto", async () => {
  const db = crearDb({
    borrador: cabeceraBorrador({ version: 3 }),
    recibos: [
      {
        id: RECIBO_ID,
        persona_id: PERSONA_ID,
        contrato_id: CONTRATO_ID,
        total_asignaciones: "950.00",
        total_deducciones: "38.00",
        monto_total: "912.00",
        cedula: "V-12345678",
        primer_nombre: "Ana",
        primer_apellido: "Pérez",
      },
      {
        id: OTRO_RECIBO_ID,
        persona_id: "99999999-9999-4999-8999-999999999999",
        contrato_id: null,
        total_asignaciones: "600.00",
        total_deducciones: "24.00",
        monto_total: "576.00",
        cedula: "V-87654321",
        primer_nombre: "Luis",
        primer_apellido: "Gómez",
      },
    ],
    detalles: [
      filaDetalle({
        id: LINEA_ID,
        reciboId: RECIBO_ID,
        conceptoId: 1,
        origen: "CALCULADA",
        monto: "800.00",
        cantidadUnidades: "80.00",
      }),
      filaDetalle({
        id: "88888888-8888-4888-8888-888888888881",
        reciboId: RECIBO_ID,
        conceptoId: 2,
        origen: "CALCULADA",
        monto: "150.00",
        cantidadUnidades: "10.00",
      }),
      filaDetalle({
        id: "88888888-8888-4888-8888-888888888882",
        reciboId: RECIBO_ID,
        conceptoId: 4,
        origen: "LEY",
        monto: "38.00",
        baseCalculo: "950.00",
        tasaAplicada: "0.0400",
        parametroAporteId: 7,
      }),
      filaDetalle({
        id: "88888888-8888-4888-8888-888888888883",
        reciboId: RECIBO_ID,
        conceptoId: 5,
        origen: "LEY",
        monto: "85.50",
        baseCalculo: "950.00",
        tasaAplicada: "0.0900",
        parametroAporteId: 7,
      }),
    ],
  });
  const preNomina = new PreNomina(db, reqConSesion());

  const respuesta = await preNomina.ver(PRE_NOMINA_ID);

  assert.equal(respuesta.preNomina.version, 3);
  assert.equal(respuesta.preNomina.periodo.descripcion, PERIODO.descripcion);
  assert.equal(respuesta.preNomina.totalAsignaciones, "1550.00");
  assert.equal(respuesta.preNomina.totalDeducciones, "62.00");
  assert.equal(respuesta.preNomina.totalAportePatronal, "85.50");
  assert.equal(respuesta.preNomina.montoTotal, "1488.00");

  assert.equal(respuesta.recibos.length, 2);
  assert.equal(respuesta.recibos[0].lineas.length, 4);
  assert.equal(respuesta.recibos[1].lineas.length, 0);

  const ley = respuesta.recibos[0].lineas.filter((linea) => linea.origen === "LEY");
  assert.equal(ley[0].editable, false);
  assert.equal(ley[0].parametroAporteId, 7);
  assert.equal(ley[0].tasaAplicada, "0.0400");
  assert.equal(ley[0].baseCalculo, "950.00");

  const sueldo = respuesta.recibos[0].lineas[0];
  assert.equal(sueldo.editable, true);
  assert.equal(sueldo.editada, false);
  assert.equal(sueldo.codigo, "SUELDO_BASE");
  assert.equal(sueldo.nombreConcepto, "Sueldo base");
});

// ---------------------------------------------------------------------------
// guardar
// ---------------------------------------------------------------------------

const L = {
  sueldo: "a0000001-0000-4000-8000-000000000001",
  extra: "a0000002-0000-4000-8000-000000000002",
  recurrente: "a0000003-0000-4000-8000-000000000003",
  novedad: "a0000004-0000-4000-8000-000000000004",
  prestamo: "a0000005-0000-4000-8000-000000000005",
  leySso: "a0000006-0000-4000-8000-000000000006",
  leyPatronal: "a0000007-0000-4000-8000-000000000007",
  sueldo2: "a0000008-0000-4000-8000-000000000008",
  leySso2: "a0000009-0000-4000-8000-000000000009",
};

const recibosBase = () => [
  {
    id: RECIBO_ID,
    persona_id: PERSONA_ID,
    contrato_id: CONTRATO_ID,
    total_asignaciones: "1200.00",
    total_deducciones: "158.00",
    monto_total: "1042.00",
    cedula: "V-12345678",
    primer_nombre: "Ana",
    primer_apellido: "Pérez",
  },
  {
    id: OTRO_RECIBO_ID,
    persona_id: "99999999-9999-4999-8999-999999999999",
    contrato_id: null,
    total_asignaciones: "600.00",
    total_deducciones: "24.00",
    monto_total: "576.00",
    cedula: "V-87654321",
    primer_nombre: "Luis",
    primer_apellido: "Gómez",
  },
];

// Recibo 1: base de ley 950 (sueldo 800 + extra 150). El recurrente, la
// novedad, el préstamo y la ley están bloqueados; el recibo 2 queda de testigo.
const detallesBase = () => [
  filaDetalle({
    id: L.sueldo,
    reciboId: RECIBO_ID,
    conceptoId: 1,
    origen: "CALCULADA",
    monto: "800.00",
    cantidadUnidades: "80.00",
  }),
  filaDetalle({
    id: L.extra,
    reciboId: RECIBO_ID,
    conceptoId: 2,
    origen: "CALCULADA",
    monto: "150.00",
    cantidadUnidades: "10.00",
  }),
  filaDetalle({
    id: L.recurrente,
    reciboId: RECIBO_ID,
    conceptoId: 6,
    origen: "RECURRENTE",
    monto: "50.00",
    conceptoPersonaId: "recurrente-1",
  }),
  filaDetalle({
    id: L.novedad,
    reciboId: RECIBO_ID,
    conceptoId: 9,
    origen: "NOVEDAD",
    monto: "200.00",
    novedadId: "novedad-1",
  }),
  filaDetalle({
    id: L.prestamo,
    reciboId: RECIBO_ID,
    conceptoId: 3,
    origen: "PRESTAMO",
    monto: "120.00",
    cuotaPrestamoId: "cuota-1",
  }),
  filaDetalle({
    id: L.leySso,
    reciboId: RECIBO_ID,
    conceptoId: 4,
    origen: "LEY",
    monto: "38.00",
    baseCalculo: "950.00",
    tasaAplicada: "0.0400",
    parametroAporteId: 7,
  }),
  filaDetalle({
    id: L.leyPatronal,
    reciboId: RECIBO_ID,
    conceptoId: 5,
    origen: "LEY",
    monto: "85.50",
    baseCalculo: "950.00",
    tasaAplicada: "0.0900",
    parametroAporteId: 7,
  }),
  filaDetalle({
    id: L.sueldo2,
    reciboId: OTRO_RECIBO_ID,
    conceptoId: 1,
    origen: "CALCULADA",
    monto: "600.00",
    cantidadUnidades: "60.00",
  }),
  filaDetalle({
    id: L.leySso2,
    reciboId: OTRO_RECIBO_ID,
    conceptoId: 4,
    origen: "LEY",
    monto: "24.00",
    baseCalculo: "600.00",
    tasaAplicada: "0.0400",
    parametroAporteId: 7,
  }),
];

const borradorBase = (extra = {}) => ({
  borrador: cabeceraBorrador({ version: 3 }),
  recibos: recibosBase(),
  detalles: detallesBase(),
  parametros: [{ id: 7, piso_base: null, tope_base: null }],
  ...extra,
});

const guardarSueldo = (db, monto, extra = {}) =>
  new PreNomina(db, reqConSesion()).guardar(PRE_NOMINA_ID, 3, {
    recibos: [
      {
        reciboId: RECIBO_ID,
        lineas: [
          { id: L.sueldo, monto, cantidadUnidades: "80.00" },
          { id: L.extra, monto: "150.00", cantidadUnidades: "10.00" },
          ...(extra.lineas ?? []),
        ],
      },
      ...(extra.recibos ?? []),
    ],
  });

test("guardar edita el sueldo: monto, neto, editada y version", async () => {
  const db = crearDb(borradorBase());

  const respuesta = await guardarSueldo(db, "1000.00");

  // El recibo 1 cambia; el 2 (omitido) queda intacto y suma al total.
  const recibo = respuesta.recibos.find((fila) => fila.id === RECIBO_ID);
  assert.equal(recibo.totalAsignaciones, "1400.00");
  assert.equal(recibo.totalDeducciones, "166.00");
  assert.equal(recibo.montoTotal, "1234.00");

  assert.equal(respuesta.preNomina.totalAsignaciones, "2000.00");
  assert.equal(respuesta.preNomina.totalDeducciones, "190.00");
  assert.equal(respuesta.preNomina.montoTotal, "1810.00");
  assert.equal(respuesta.preNomina.totalAportePatronal, "103.50");
  assert.equal(respuesta.preNomina.version, 4);

  const sueldo = recibo.lineas.find((linea) => linea.id === L.sueldo);
  assert.equal(sueldo.monto, "1000.00");
  assert.equal(sueldo.editada, true);
  const extra = recibo.lineas.find((linea) => linea.id === L.extra);
  assert.equal(extra.monto, "150.00");
  assert.equal(extra.editada, false);
});

test("guardar agrega una línea MANUAL que suma al neto", async () => {
  const db = crearDb(borradorBase());

  const respuesta = await guardarSueldo(db, "800.00", {
    lineas: [{ id: null, conceptoId: 10, monto: "100.00", cantidadUnidades: null }],
  });

  const recibo = respuesta.recibos.find((fila) => fila.id === RECIBO_ID);
  assert.equal(recibo.totalAsignaciones, "1300.00");
  assert.equal(recibo.montoTotal, "1142.00");

  const manual = recibo.lineas.find((linea) => linea.origen === "MANUAL");
  assert.ok(manual, "debe existir la línea MANUAL");
  assert.equal(manual.conceptoId, 10);
  assert.equal(manual.monto, "100.00");
  assert.equal(manual.editada, true);
  assert.equal(manual.editable, true);
});

test("guardar omite una editable y la borra", async () => {
  const db = crearDb(borradorBase());

  await new PreNomina(db, reqConSesion()).guardar(PRE_NOMINA_ID, 3, {
    recibos: [
      {
        reciboId: RECIBO_ID,
        lineas: [{ id: L.sueldo, monto: "800.00", cantidadUnidades: "80.00" }],
      },
    ],
  });

  const borrado = llamadasDe(db, queries.deletePreNominaDetalleEditables);
  assert.equal(borrado.length, 1);
  assert.deepEqual(borrado[0].params, [RECIBO_ID, [L.sueldo]]);

  const restantes = db.estado.detalles.filter(
    (fila) => fila.pre_nomina_recibo_id === RECIBO_ID,
  );
  assert.equal(restantes.some((fila) => fila.id === L.extra), false);
});

test("guardar un recibo omitido lo deja intacto", async () => {
  const db = crearDb(borradorBase());

  const respuesta = await guardarSueldo(db, "800.00");

  const otro = respuesta.recibos.find((fila) => fila.id === OTRO_RECIBO_ID);
  assert.equal(otro.totalAsignaciones, "600.00");
  assert.equal(otro.totalDeducciones, "24.00");
  assert.equal(otro.lineas.length, 2);
  assert.equal(llamadasDe(db, queries.deletePreNominaDetalleEditables).length, 1);
});

test("guardar con recibos vacío responde 400 sin tocar la base", async () => {
  const db = crearDb(borradorBase());

  await rechazaCon(
    new PreNomina(db, reqConSesion()).guardar(PRE_NOMINA_ID, 3, { recibos: [] }),
    400,
    /No se enviaron recibos/,
  );
  assert.equal(db.llamadas.length, 0);
});

test("guardar una línea bloqueada responde 400", async () => {
  for (const id of [L.recurrente, L.novedad, L.prestamo, L.leySso]) {
    const db = crearDb(borradorBase());
    await rechazaCon(
      new PreNomina(db, reqConSesion()).guardar(PRE_NOMINA_ID, 3, {
        recibos: [{ reciboId: RECIBO_ID, lineas: [{ id, monto: "10.00" }] }],
      }),
      400,
      /no es editable/,
    );
    assert.equal(llamadasDe(db, queries.updatePreNominaDetalleMonto).length, 0);
  }
});

test("guardar no permite cambiar el concepto de una línea existente", async () => {
  const db = crearDb(borradorBase());

  await rechazaCon(
    new PreNomina(db, reqConSesion()).guardar(PRE_NOMINA_ID, 3, {
      recibos: [
        {
          reciboId: RECIBO_ID,
          lineas: [{ id: L.sueldo, conceptoId: 2, monto: "800.00" }],
        },
      ],
    }),
    400,
    /No se puede cambiar el concepto/,
  );
});

test("guardar rechaza conceptos inválidos para una línea nueva", async () => {
  const casos = [
    [999, /no existe o está inactivo/],
    [7, /no existe o está inactivo/],
    [5, /solo puede ser ASIGNACION o DEDUCCION/],
    [8, /categoría del concepto no admite/],
    [1, /lo genera el sistema/],
  ];

  for (const [conceptoId, mensaje] of casos) {
    const db = crearDb(borradorBase());
    await rechazaCon(
      new PreNomina(db, reqConSesion()).guardar(PRE_NOMINA_ID, 3, {
        recibos: [
          {
            reciboId: RECIBO_ID,
            lineas: [
              { id: L.sueldo, monto: "800.00" },
              { id: null, conceptoId, monto: "10.00" },
            ],
          },
        ],
      }),
      400,
      mensaje,
    );
  }
});

test("guardar rechaza un concepto repetido en el recibo", async () => {
  const db = crearDb(borradorBase());

  await rechazaCon(
    new PreNomina(db, reqConSesion()).guardar(PRE_NOMINA_ID, 3, {
      recibos: [
        {
          reciboId: RECIBO_ID,
          lineas: [
            { id: L.sueldo, monto: "800.00" },
            { id: null, conceptoId: 6, monto: "10.00" },
          ],
        },
      ],
    }),
    400,
    /ya tiene una línea en este recibo/,
  );
});

test("guardar valida monto y cantidadUnidades", async () => {
  const montos = [
    ["0", /mayor que cero/],
    ["-5", /número positivo/],
    ["1.234", /número positivo/],
    ["abc", /número positivo/],
  ];
  for (const [monto, mensaje] of montos) {
    const db = crearDb(borradorBase());
    await rechazaCon(guardarSueldo(db, monto), 400, mensaje);
    assert.equal(llamadasDe(db, queries.updatePreNominaDetalleMonto).length, 0);
  }

  const cantidades = ["-2", "1.234", "abc"];
  for (const cantidadUnidades of cantidades) {
    const db = crearDb(borradorBase());
    await rechazaCon(
      new PreNomina(db, reqConSesion()).guardar(PRE_NOMINA_ID, 3, {
        recibos: [
          {
            reciboId: RECIBO_ID,
            lineas: [{ id: L.sueldo, monto: "800.00", cantidadUnidades }],
          },
        ],
      }),
      400,
      /cantidadUnidades/,
    );
  }
});

test("guardar rechaza reciboId y lineaId ajenos", async () => {
  const db = crearDb(borradorBase());
  await rechazaCon(
    new PreNomina(db, reqConSesion()).guardar(PRE_NOMINA_ID, 3, {
      recibos: [
        {
          reciboId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          lineas: [],
        },
      ],
    }),
    400,
    /no pertenece a la pre-nómina/,
  );

  const db2 = crearDb(borradorBase());
  await rechazaCon(
    new PreNomina(db2, reqConSesion()).guardar(PRE_NOMINA_ID, 3, {
      recibos: [
        { reciboId: RECIBO_ID, lineas: [{ id: L.sueldo2, monto: "600.00" }] },
      ],
    }),
    400,
    /no pertenece a este recibo/,
  );
});

test("guardar con version vieja responde 409 sin escribir", async () => {
  const db = crearDb(borradorBase());

  await rechazaCon(
    new PreNomina(db, reqConSesion()).guardar(PRE_NOMINA_ID, 2, {
      recibos: [{ reciboId: RECIBO_ID, lineas: [{ id: L.sueldo, monto: "1.00" }] }],
    }),
    409,
    /cambió desde que la abriste/,
  );
  assert.equal(llamadasDe(db, queries.deletePreNominaDetalleEditables).length, 0);
  assert.equal(llamadasDe(db, queries.updatePreNominaDetalleMonto).length, 0);
  assert.equal(llamadasDe(db, queries.touchPreNomina).length, 0);
});

test("guardar con el período ya no BORRADOR responde 409", async () => {
  const db = crearDb(
    borradorBase({ periodo: { ...PERIODO, estado: "PROCESADO" } }),
  );

  await rechazaCon(guardarSueldo(db, "1000.00"), 409, /período en BORRADOR/);
  assert.equal(llamadasDe(db, queries.updatePreNominaDetalleMonto).length, 0);
});

test("guardar recalcula la ley con la tasa congelada y la base nueva", async () => {
  const db = crearDb(borradorBase());

  await guardarSueldo(db, "1000.00");

  const leyes = llamadasDe(db, queries.updatePreNominaDetalleLey).map((l) => l.params);
  assert.deepEqual(leyes, [
    [L.leySso, "1150.00", "46.00"],
    [L.leyPatronal, "1150.00", "103.50"],
  ]);
});

test("guardar una ley que baja a cero la borra en vez de escribir 0", async () => {
  const db = crearDb(borradorBase());

  // Se omite la extra: la base de ley queda en 0.01 y 0.01 × 0.04 / × 0.09
  // redondean a 0.00. El CHECK exige monto > 0, así que la línea se borra.
  await new PreNomina(db, reqConSesion()).guardar(PRE_NOMINA_ID, 3, {
    recibos: [
      { reciboId: RECIBO_ID, lineas: [{ id: L.sueldo, monto: "0.01" }] },
    ],
  });

  const borradas = llamadasDe(db, queries.deletePreNominaDetalle).map(
    (l) => l.params[0],
  );
  assert.deepEqual(borradas.sort(), [L.leySso, L.leyPatronal].sort());
  assert.equal(llamadasDe(db, queries.updatePreNominaDetalleLey).length, 0);
});
