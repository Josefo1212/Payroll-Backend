// E2E de horas extras por HTTP, contra la BD apuntada por DATABASE_URL.
// Requiere las migraciones 001–013 aplicadas y el usuario de prueba
// (db/seed-usuario-prueba.sql). Escribe en la BD: usar un branch desechable.
//
//   node scripts/manual/horas_extras_e2e.mjs --yes
//
// Verifica: Superusuario y RRHH registran/listan/quitan extras, el upsert
// suma sobre la fila del día, quitar conserva las horas normales, la pantalla
// actual de Horas sigue funcionando para RRHH y la opción de menú es visible
// para ambos. Limpia sus datos al final.
import "./_guard.mjs";
import app from "../../src/app.js";
import { security } from "../../src/security/Security.js";
import { db } from "../../src/database/Database.js";

const CLAVE = "E2eClave123";
const PERIODO = {
  frecuencia: "SEMANAL",
  inicio: "2032-05-03",
  fin: "2032-05-09",
  descripcion: "E2E horas extras semanal",
};
const DIA_EXTRA = "2032-05-03";
const DIA_MIXTO = "2032-05-04";
const DIA_RRHH = "2032-05-05";

const PERSONAS = [
  {
    cedula: "E2E-HORAS-001",
    username: "e2e_horas_001",
    email: "e2e.horas.001@example.test",
    perfil: "Empleado",
  },
  {
    cedula: "E2E-HORAS-RRHH-001",
    username: "e2e_horas_rrhh_001",
    email: "e2e.horas.rrhh.001@example.test",
    perfil: "RRHH",
  },
];

const casos = [];
const check = (nombre, actual, esperado) => {
  casos.push({ nombre, actual, esperado });
  if (JSON.stringify(actual) !== JSON.stringify(esperado)) {
    throw new Error(
      `FALLÓ "${nombre}": esperado ${JSON.stringify(esperado)}, recibido ${JSON.stringify(actual)}`,
    );
  }
};

const crearCliente = (base) => {
  const cookies = new Map();
  const pedir = async (ruta, { method = "GET", body } = {}) => {
    const respuesta = await fetch(`${base}${ruta}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookies.size
          ? { Cookie: [...cookies].map(([clave, valor]) => `${clave}=${valor}`).join("; ") }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    for (const linea of respuesta.headers.getSetCookie?.() ?? []) {
      const par = linea.split(";")[0];
      const corte = par.indexOf("=");
      const nombre = par.slice(0, corte);
      const valor = par.slice(corte + 1);
      if (valor === "") {
        cookies.delete(nombre);
      } else {
        cookies.set(nombre, valor);
      }
    }

    return { status: respuesta.status, body: await respuesta.json().catch(() => null) };
  };
  return { pedir };
};

const ejecutar = (cliente, subsystem, clase, method, params = []) =>
  cliente.pedir("/api/execute", {
    method: "POST",
    body: { subsystem, class: clase, method, params },
  });

// node-pg devuelve `date` como Date; al serializar a JSON llega con hora.
const diaISO = (fecha) => String(fecha).slice(0, 10);

const limpiar = async () => {
  const cedulas = PERSONAS.map((p) => p.cedula);
  const usernames = PERSONAS.map((p) => p.username);

  const { rows: personas } = await db.query(
    "SELECT id FROM persona WHERE cedula = ANY($1::text[])",
    [cedulas],
  );
  const personaIds = personas.map((fila) => fila.id);

  const { rows: usuarios } = await db.query(
    "SELECT id FROM usuario WHERE username = ANY($1::text[])",
    [usernames],
  );
  const usuarioIds = usuarios.map((fila) => fila.id);

  const { rows: periodos } = await db.query(
    `SELECT id FROM periodo_nomina
      WHERE frecuencia = $1 AND fecha_inicio = $2 AND fecha_fin = $3`,
    [PERIODO.frecuencia, PERIODO.inicio, PERIODO.fin],
  );
  for (const periodo of periodos) {
    await db.query(
      "DELETE FROM detalle_recibo WHERE recibo_pago_id IN (SELECT id FROM recibo_pago WHERE periodo_nomina_id = $1)",
      [periodo.id],
    );
    await db.query("DELETE FROM recibo_pago WHERE periodo_nomina_id = $1", [periodo.id]);
    await db.query("DELETE FROM novedad WHERE periodo_nomina_id = $1", [periodo.id]);
    await db.query("DELETE FROM periodo_nomina WHERE id = $1", [periodo.id]);
  }

  if (personaIds.length > 0) {
    await db.query("DELETE FROM registro_horas WHERE persona_id = ANY($1::uuid[])", [personaIds]);
    await db.query(
      "DELETE FROM contrato_salario WHERE contrato_id IN (SELECT id FROM contrato WHERE persona_id = ANY($1::uuid[]))",
      [personaIds],
    );
    await db.query("DELETE FROM contrato WHERE persona_id = ANY($1::uuid[])", [personaIds]);
  }

  if (usuarioIds.length > 0) {
    await db.query("DELETE FROM refresh_token WHERE usuario_id = ANY($1::uuid[])", [usuarioIds]);
    await db.query("DELETE FROM usuario_perfil WHERE usuario_id = ANY($1::uuid[])", [usuarioIds]);
    await db.query("DELETE FROM usuario WHERE id = ANY($1::uuid[])", [usuarioIds]);
  }

  if (personaIds.length > 0) {
    await db.query("DELETE FROM persona WHERE id = ANY($1::uuid[])", [personaIds]);
  }
};

const altaPersona = async (admin, datos, cargoId, perfilId) => {
  const alta = await ejecutar(admin, "Security", "User", "registrar", [
    {
      cedula: datos.cedula,
      primer_nombre: "E2E",
      primer_apellido: "Horas",
      email: datos.email,
      username: datos.username,
      password: CLAVE,
      perfiles: [perfilId],
      laboral: {
        cargo_id: cargoId,
        fecha_inicio: "2026-01-01",
        tipo_pago: "POR_HORA",
        frecuencia_pago: "SEMANAL",
        monto: 10,
        horas_semanales: 40,
      },
    },
  ]);
  check(`registrar ${datos.username}`, alta.status, 200);
  return alta.body.persona_id;
};

await security.loadPermission();

const server = await new Promise((resolve) => {
  const instancia = app.listen(0, "127.0.0.1", () => resolve(instancia));
});
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const choque = await db.query(
    `SELECT descripcion FROM periodo_nomina
      WHERE frecuencia = $1 AND fecha_inicio = $2 AND fecha_fin = $3`,
    [PERIODO.frecuencia, PERIODO.inicio, PERIODO.fin],
  );
  if (choque.rows[0] && !String(choque.rows[0].descripcion ?? "").startsWith("E2E")) {
    throw new Error(
      `Ya existe un período real en ${PERIODO.inicio}..${PERIODO.fin}. ` +
        "Corré el E2E en un branch desechable.",
    );
  }

  await limpiar();

  const admin = crearCliente(base);
  const loginAdmin = await admin.pedir("/api/login", {
    method: "POST",
    body: { username: "admin_prueba", password: "Password123" },
  });
  check("login admin_prueba", loginAdmin.status, 200);

  const perfiles = await ejecutar(admin, "Security", "User", "listarPerfiles");
  check("listarPerfiles", perfiles.status, 200);
  const porNombre = new Map(perfiles.body.map((perfil) => [perfil.nombre, perfil.id]));
  check("perfil Empleado existe", porNombre.has("Empleado"), true);
  check("perfil RRHH existe", porNombre.has("RRHH"), true);

  const cargos = await ejecutar(admin, "Security", "User", "listarCargos");
  check("listarCargos", cargos.status, 200);
  const cargoId = cargos.body[0].id;

  const personaId = await altaPersona(admin, PERSONAS[0], cargoId, porNombre.get("Empleado"));
  const personaRrhhId = await altaPersona(admin, PERSONAS[1], cargoId, porNombre.get("RRHH"));

  const rrhh = crearCliente(base);
  const loginRrhh = await rrhh.pedir("/api/login", {
    method: "POST",
    body: { username: PERSONAS[1].username, password: CLAVE },
  });
  check("login rrhh", loginRrhh.status, 200);
  const cambioRrhh = await ejecutar(rrhh, "Security", "User", "cambiarClave", [CLAVE, CLAVE]);
  check("cambiar clave rrhh", cambioRrhh.status, 200);

  // --- Registrar extras: upsert sobre el mismo día ------------------------
  const extra1 = await ejecutar(admin, "Payroll", "Hours", "registrarExtra", [
    personaId,
    DIA_EXTRA,
    2.5,
    "E2E extra",
  ]);
  check("registrar extra", extra1.status, 200);
  check("extra guardada", extra1.body.horas_extra, "2.50");
  check("sin horas normales", extra1.body.horas_normales, "0.00");

  const extra2 = await ejecutar(admin, "Payroll", "Hours", "registrarExtra", [
    personaId,
    DIA_EXTRA,
    1.25,
    null,
  ]);
  check("segunda extra el mismo día", extra2.status, 200);
  check("las extras se suman", extra2.body.horas_extra, "3.75");

  // --- Listado por período -----------------------------------------------
  const periodo = await ejecutar(admin, "Payroll", "Period", "crear", [
    PERIODO.frecuencia,
    PERIODO.inicio,
    PERIODO.fin,
    PERIODO.descripcion,
  ]);
  check("crear período", periodo.status, 200);
  const periodoId = periodo.body.id;

  const listado1 = await ejecutar(admin, "Payroll", "Hours", "listarExtrasPorPeriodo", [
    periodoId,
  ]);
  check("listar extras", listado1.status, 200);
  check("una fila con extras", listado1.body.length, 1);
  check("fila del empleado", listado1.body[0].persona_id, personaId);
  check("monto del listado", listado1.body[0].horas_extra, "3.75");

  // --- RRHH también registra, lista y quita extras -----------------------
  const rrhhRegistra = await ejecutar(rrhh, "Payroll", "Hours", "registrarExtra", [
    personaRrhhId,
    DIA_RRHH,
    1,
  ]);
  check("RRHH registra extras", rrhhRegistra.status, 200);

  const rrhhLista = await ejecutar(rrhh, "Payroll", "Hours", "listarExtrasPorPeriodo", [
    periodoId,
  ]);
  check("RRHH lista extras", rrhhLista.status, 200);
  check("RRHH ve las extras del período", rrhhLista.body.length, 2);
  const filaRrhh = rrhhLista.body.find((fila) => fila.persona_id === personaRrhhId);
  check("fila de RRHH existe", Boolean(filaRrhh), true);

  const rrhhQuita = await ejecutar(rrhh, "Payroll", "Hours", "quitarExtra", [
    filaRrhh.id,
  ]);
  check("RRHH quita su extra", rrhhQuita.status, 200);
  check("RRHH elimina la fila", rrhhQuita.body.eliminado, true);

  // --- La pantalla actual de Horas sigue funcionando para RRHH -----------
  const normales = await ejecutar(rrhh, "Payroll", "Hours", "registrar", [
    personaId,
    DIA_MIXTO,
    8,
    0,
    "E2E normales",
  ]);
  check("RRHH registra horas normales", normales.status, 200);

  const extraSobreNormales = await ejecutar(admin, "Payroll", "Hours", "registrarExtra", [
    personaId,
    DIA_MIXTO,
    2,
    "E2E mixto",
  ]);
  check("extra sobre fila de RRHH", extraSobreNormales.status, 200);
  check("conserva normales", extraSobreNormales.body.horas_normales, "8.00");
  check("suma la extra", extraSobreNormales.body.horas_extra, "2.00");

  const listado2 = await ejecutar(admin, "Payroll", "Hours", "listarExtrasPorPeriodo", [
    periodoId,
  ]);
  check("dos filas con extras", listado2.body.length, 2);
  const mixto = listado2.body.find((fila) => diaISO(fila.fecha) === DIA_MIXTO);
  check("fila mixta existe", Boolean(mixto), true);

  // --- Quitar extra conserva las horas normales --------------------------
  const quitarMixto = await ejecutar(admin, "Payroll", "Hours", "quitarExtra", [mixto.id]);
  check("quitar extra de fila mixta", quitarMixto.status, 200);
  check("no elimina la fila", quitarMixto.body.eliminado, false);

  const trasQuitar = await ejecutar(admin, "Payroll", "Hours", "listarPorPersona", [
    personaId,
    DIA_MIXTO,
    DIA_MIXTO,
  ]);
  check("listarPorPersona", trasQuitar.status, 200);
  check("conserva horas normales", trasQuitar.body[0].horas_normales, "8.00");
  check("extra en cero", trasQuitar.body[0].horas_extra, "0.00");

  // --- Quitar una fila que solo tenía extras -----------------------------
  const soloExtra = listado2.body.find((fila) => diaISO(fila.fecha) === DIA_EXTRA);
  const quitarSoloExtra = await ejecutar(admin, "Payroll", "Hours", "quitarExtra", [
    soloExtra.id,
  ]);
  check("quitar fila solo de extras", quitarSoloExtra.status, 200);
  check("elimina la fila", quitarSoloExtra.body.eliminado, true);

  const listado3 = await ejecutar(admin, "Payroll", "Hours", "listarExtrasPorPeriodo", [
    periodoId,
  ]);
  check("sin extras tras quitar", listado3.body.length, 0);

  const quitarInexistente = await ejecutar(admin, "Payroll", "Hours", "quitarExtra", [
    soloExtra.id,
  ]);
  check("quitar registro inexistente", quitarInexistente.status, 404);

  // --- Menú: la opción es visible para Superusuario y RRHH ---------------
  const menuAdmin = await ejecutar(admin, "Security", "Menu", "getOptions");
  check("menú admin", menuAdmin.status, 200);
  check(
    "admin ve HorasExtras",
    menuAdmin.body.some((opcion) => opcion.nombre === "HorasExtras"),
    true,
  );

  const menuRrhh = await ejecutar(rrhh, "Security", "Menu", "getOptions");
  check("menú rrhh", menuRrhh.status, 200);
  check(
    "RRHH ve HorasExtras",
    menuRrhh.body.some((opcion) => opcion.nombre === "HorasExtras"),
    true,
  );

} finally {
  await limpiar();
  const residuos = await db.query(
    "SELECT count(*)::int AS n FROM usuario WHERE username = ANY($1::text[])",
    [PERSONAS.map((p) => p.username)],
  );
  check("sin residuos de usuario", residuos.rows[0].n, 0);
  await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
}

console.table(casos);
console.log("HORAS EXTRAS E2E OK");
process.exit(0);
