import { test } from "node:test";
import assert from "node:assert/strict";
import { Employee } from "../src/bo/Payroll/Employee.js";
import { queries } from "../src/bo/Payroll/loader.js";
import { queries as sessionQueries } from "../src/bo/Session/loader.js";
import { ErrorNegocio } from "../src/errors/ErrorNegocio.js";
import { crearReq } from "./helpers.js";

const PERSONA_ID = "22222222-2222-4222-8222-222222222222";
const CONTRATO_ID = "44444444-4444-4444-8444-444444444444";
const USUARIO_ID = "11111111-1111-4111-8111-111111111111";
const DESPIDO_ID = "77777777-7777-4777-8777-777777777777";

const MOTIVOS = [
  "RENUNCIA",
  "DESPIDO_JUSTIFICADO",
  "DESPIDO_INJUSTIFICADO",
  "FIN_DE_CONTRATO",
  "JUBILACION",
  "FALLECIMIENTO",
];

const PERSONA = {
  id: PERSONA_ID,
  cedula: "V-14567890",
  primer_nombre: "Luis",
  primer_apellido: "Gómez",
  estado: "ACTIVO",
};

const CONTRATO = {
  id: CONTRATO_ID,
  persona_id: PERSONA_ID,
  fecha_inicio: "2020-01-01",
  fecha_fin: null,
  estado: "VIGENTE",
};

function crearDb({
  persona = PERSONA,
  personaDetalle = PERSONA,
  contrato = CONTRATO,
  despidoExistente = null,
  usuario = { id: USUARIO_ID },
  personas = [],
  contratos = [],
  despidos = [],
  motivos = MOTIVOS,
  tokens = 2,
  sesiones = 1,
} = {}) {
  const llamadas = [];
  const ejecutadas = [];

  const responder = async (texto, params = []) => {
    llamadas.push({ texto, params });

    if (texto === queries.listarMotivosDespido) {
      return { rows: motivos.map((motivo) => ({ motivo })) };
    }
    if (texto === queries.findPersonaRegistro) {
      return { rows: personaDetalle ? [personaDetalle] : [] };
    }
    if (texto === queries.listarPersonasRegistro) {
      return { rows: personas };
    }
    if (texto === queries.findContratosDePersona) {
      return { rows: contratos };
    }
    if (texto === queries.findDespidosDePersona) {
      return { rows: despidos };
    }
    if (texto === queries.findPersonaForUpdate) {
      return { rows: persona ? [persona] : [] };
    }
    if (texto === queries.findContratoVigenteForUpdate) {
      return { rows: contrato ? [contrato] : [] };
    }
    if (texto === queries.findDespidoPorContrato) {
      return { rows: despidoExistente ? [despidoExistente] : [] };
    }
    if (texto === queries.insertDespido) {
      ejecutadas.push("insertDespido");
      return {
        rows: [
          {
            id: DESPIDO_ID,
            persona_id: params[0],
            contrato_id: params[1],
            motivo: params[2],
            fecha_despido: params[3],
            descripcion: params[4],
            registrado_por: params[5],
          },
        ],
      };
    }
    if (texto === queries.finalizarContrato) {
      ejecutadas.push("finalizarContrato");
      return {
        rows: [{ id: params[0], estado: "FINALIZADO", fecha_fin: params[1] }],
      };
    }
    if (texto === queries.inactivarPersona) {
      ejecutadas.push("inactivarPersona");
      return { rows: [{ id: params[0], estado: "INACTIVO" }] };
    }
    if (texto === queries.desactivarUsuarioDePersona) {
      ejecutadas.push("desactivarUsuario");
      return { rows: usuario ? [usuario] : [] };
    }
    if (texto === sessionQueries.revokeAllUserTokens) {
      ejecutadas.push("revocarTokens");
      return { rows: [], rowCount: tokens };
    }
    if (texto === sessionQueries.borrarSesionesDeUsuario) {
      ejecutadas.push("borrarSesiones");
      return { rows: [], rowCount: sesiones };
    }
    if (texto === queries.listarDespidosRegistro) {
      return { rows: despidos };
    }

    throw new Error(`Consulta no simulada: ${texto}`);
  };

  const db = {
    llamadas,
    ejecutadas,
    query: responder,
    transaction: async (callback) => {
      llamadas.push({ texto: "BEGIN", params: [] });
      const resultado = await callback(db);
      llamadas.push({ texto: "COMMIT", params: [] });
      return resultado;
    },
  };

  return db;
}

const crearEmployee = (db) =>
  new Employee(db, crearReq({ userID: USUARIO_ID }));

test("despedir cierra contrato, persona, usuario, tokens y sesiones", async () => {
  const db = crearDb();
  const resultado = await crearEmployee(db).despedir(
    PERSONA_ID,
    "RENUNCIA",
    "2026-11-18",
    "  Renuncia voluntaria  ",
  );

  assert.equal(resultado.despido.id, DESPIDO_ID);
  assert.equal(resultado.despido.descripcion, "Renuncia voluntaria");
  assert.equal(resultado.contrato.estado, "FINALIZADO");
  assert.equal(resultado.contrato.fecha_fin, "2026-11-18");
  assert.equal(resultado.usuarioDesactivado, true);
  assert.equal(resultado.tokensRevocados, 2);
  assert.equal(resultado.sesionesCerradas, 1);
  assert.deepEqual(db.ejecutadas, [
    "insertDespido",
    "finalizarContrato",
    "inactivarPersona",
    "desactivarUsuario",
    "revocarTokens",
    "borrarSesiones",
  ]);

  const insert = db.llamadas.find((llamada) => llamada.texto === queries.insertDespido);
  assert.equal(insert.params[2], "RENUNCIA");
  assert.equal(insert.params[5], USUARIO_ID);
});

test("despedir sin usuario asociado no falla y reporta cero sesiones", async () => {
  const db = crearDb({ usuario: null });
  const resultado = await crearEmployee(db).despedir(
    PERSONA_ID,
    "FIN_DE_CONTRATO",
    "2026-11-18",
  );

  assert.equal(resultado.usuarioDesactivado, false);
  assert.equal(resultado.tokensRevocados, 0);
  assert.equal(resultado.sesionesCerradas, 0);
  assert.ok(!db.ejecutadas.includes("revocarTokens"));
});

test("despedir rechaza persona inexistente con 404", async () => {
  const db = crearDb({ persona: null });
  await assert.rejects(
    () => crearEmployee(db).despedir(PERSONA_ID, "RENUNCIA", "2026-11-18"),
    (error) =>
      error instanceof ErrorNegocio && error.status === 404 && /no existe/.test(error.message),
  );
  assert.ok(!db.ejecutadas.includes("insertDespido"));
});

test("despedir rechaza persona ya inactiva y contrato inexistente con 409", async () => {
  await assert.rejects(
    () =>
      crearEmployee(crearDb({ persona: { ...PERSONA, estado: "INACTIVO" } })).despedir(
        PERSONA_ID,
        "RENUNCIA",
        "2026-11-18",
      ),
    (error) => error instanceof ErrorNegocio && error.status === 409,
  );

  await assert.rejects(
    () => crearEmployee(crearDb({ contrato: null })).despedir(PERSONA_ID, "RENUNCIA", "2026-11-18"),
    (error) =>
      error instanceof ErrorNegocio && error.status === 409 && /contrato vigente/.test(error.message),
  );
});

test("despedir rechaza un contrato ya despedido con 409", async () => {
  const db = crearDb({ despidoExistente: { id: DESPIDO_ID } });
  await assert.rejects(
    () => crearEmployee(db).despedir(PERSONA_ID, "RENUNCIA", "2026-11-18"),
    (error) =>
      error instanceof ErrorNegocio && error.status === 409 && /ya tiene un despido/.test(error.message),
  );
});

test("despedir valida motivo, fecha real, fecha futura y fecha previa al contrato", async () => {
  const employee = crearEmployee(crearDb());

  await assert.rejects(
    () => employee.despedir(PERSONA_ID, "DESPIDO", "2026-11-18"),
    (error) => error instanceof ErrorNegocio && error.status === 400 && /motivo/.test(error.message),
  );
  await assert.rejects(
    () => employee.despedir(PERSONA_ID, "RENUNCIA", "2026-02-30"),
    (error) => error instanceof ErrorNegocio && error.status === 400 && /fecha real/.test(error.message),
  );
  await assert.rejects(
    () => employee.despedir(PERSONA_ID, "RENUNCIA", "2999-01-01"),
    (error) => error instanceof ErrorNegocio && error.status === 400 && /futura/.test(error.message),
  );
  await assert.rejects(
    () => employee.despedir(PERSONA_ID, "RENUNCIA", "2019-12-31"),
    (error) =>
      error instanceof ErrorNegocio && error.status === 400 && /anterior al inicio/.test(error.message),
  );
  await assert.rejects(
    () => employee.despedir("no-es-uuid", "RENUNCIA", "2026-11-18"),
    (error) => error instanceof ErrorNegocio && error.status === 400 && /UUID/.test(error.message),
  );
});

test("despedir valida la descripción de más de 250 caracteres", async () => {
  await assert.rejects(
    () =>
      crearEmployee(crearDb()).despedir(
        PERSONA_ID,
        "RENUNCIA",
        "2026-11-18",
        "x".repeat(251),
      ),
    (error) =>
      error instanceof ErrorNegocio && error.status === 400 && /250/.test(error.message),
  );
});

test("listar valida el estado y devuelve las filas", async () => {
  const filas = [{ id: PERSONA_ID, estado: "ACTIVO" }];
  const db = crearDb({ personas: filas });
  const employee = crearEmployee(db);

  assert.deepEqual(await employee.listar(), filas);
  assert.deepEqual(await employee.listar("ACTIVO"), filas);
  await assert.rejects(
    () => employee.listar("BAJA"),
    (error) => error instanceof ErrorNegocio && error.status === 400,
  );
});

test("ver devuelve persona, contratos y despidos; 404 si no existe", async () => {
  const db = crearDb({ contratos: [CONTRATO], despidos: [{ id: DESPIDO_ID }] });
  const resultado = await crearEmployee(db).ver(PERSONA_ID);

  assert.equal(resultado.persona.id, PERSONA_ID);
  assert.equal(resultado.contratos.length, 1);
  assert.equal(resultado.despidos.length, 1);

  await assert.rejects(
    () => crearEmployee(crearDb({ personaDetalle: null })).ver(PERSONA_ID),
    (error) => error instanceof ErrorNegocio && error.status === 404,
  );
});

test("listarMotivos devuelve los valores del enum en orden", async () => {
  const motivos = await crearEmployee(crearDb()).listarMotivos();
  assert.deepEqual(motivos, MOTIVOS);
});

test("listarDespidos devuelve el histórico", async () => {
  const filas = [{ id: DESPIDO_ID, motivo: "RENUNCIA" }];
  const db = crearDb({ despidos: filas });
  assert.deepEqual(await crearEmployee(db).listarDespidos(), filas);
});
