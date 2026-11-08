// E2E del subsistema Payroll por HTTP, contra la BD apuntada por DATABASE_URL.
// Requiere las migraciones 001–005 aplicadas y crear el usuario de prueba
// (db/seed-usuario-prueba.sql). Escribe en la BD: usar un branch desechable.
//
//   node scripts/manual/payroll_e2e.mjs --yes
//
// Flujo: login RRHH → alta de empleado con contrato → afiliaciones → bono
// recurrente → horas → préstamo → período → procesar → verificar montos →
// pagar → el empleado ve su recibo. Limpia sus datos al final.
import "./_guard.mjs";
import app from "../../src/app.js";
import { security } from "../../src/security/Security.js";
import { db } from "../../src/database/Database.js";

const CEDULA = "E2E-PAYROLL-001";
const USERNAME = "e2e_payroll_001";
const EMAIL = "e2e.payroll.001@example.test";
const CLAVE = "E2eClave123";
const FECHA_CONTRATO = "2026-01-01";
const FECHA_HORAS = "2031-03-04";
const PERIODO = { frecuencia: "SEMANAL", inicio: "2031-03-03", fin: "2031-03-09", descripcion: "E2E nomina semanal" };

const casos = [];
const check = (nombre, actual, esperado) => {
  casos.push({ nombre, actual, esperado });
  if (JSON.stringify(actual) !== JSON.stringify(esperado)) {
    throw new Error(`FALLÓ "${nombre}": esperado ${JSON.stringify(esperado)}, recibido ${JSON.stringify(actual)}`);
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

const limpiar = async () => {
  const { rows: usuarios } = await db.query(
    "SELECT id, persona_id FROM usuario WHERE username = $1",
    [USERNAME],
  );
  const usuario = usuarios[0];
  let personaId = usuario?.persona_id ?? null;
  if (!personaId) {
    const { rows: personas } = await db.query(
      "SELECT id FROM persona WHERE cedula = $1",
      [CEDULA],
    );
    personaId = personas[0]?.id ?? null;
  }

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

  if (personaId) {
    await db.query(
      "DELETE FROM detalle_recibo WHERE recibo_pago_id IN (SELECT id FROM recibo_pago WHERE persona_id = $1)",
      [personaId],
    );
    await db.query("DELETE FROM recibo_pago WHERE persona_id = $1", [personaId]);
    await db.query("DELETE FROM novedad WHERE persona_id = $1", [personaId]);
    await db.query("DELETE FROM concepto_persona WHERE persona_id = $1", [personaId]);
    await db.query("DELETE FROM afiliacion_ley WHERE persona_id = $1", [personaId]);
    await db.query("DELETE FROM registro_horas WHERE persona_id = $1", [personaId]);
    await db.query(
      "DELETE FROM cuota_prestamo WHERE prestamo_id IN (SELECT id FROM prestamo WHERE persona_id = $1)",
      [personaId],
    );
    await db.query("DELETE FROM prestamo WHERE persona_id = $1", [personaId]);
    await db.query(
      "DELETE FROM contrato_salario WHERE contrato_id IN (SELECT id FROM contrato WHERE persona_id = $1)",
      [personaId],
    );
    await db.query("DELETE FROM contrato WHERE persona_id = $1", [personaId]);
  }

  if (usuario) {
    await db.query("DELETE FROM refresh_token WHERE usuario_id = $1", [usuario.id]);
    await db.query("DELETE FROM usuario_perfil WHERE usuario_id = $1", [usuario.id]);
    await db.query("DELETE FROM usuario WHERE id = $1", [usuario.id]);
  }

  if (personaId) {
    await db.query("DELETE FROM persona WHERE id = $1", [personaId]);
  }
};

await security.loadPermission();

const server = await new Promise((resolve) => {
  const instancia = app.listen(0, "127.0.0.1", () => resolve(instancia));
});
const base = `http://127.0.0.1:${server.address().port}`;

let reciboId = null;

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

  const { rows: tipos } = await db.query(
    "SELECT id, codigo FROM tipo_aporte_ley WHERE codigo = ANY($1::text[]) ORDER BY id",
    [["SSO", "PARO_FORZOSO", "VIVIENDA"]],
  );
  if (tipos.length === 0) {
    throw new Error("Faltan los tipos de aporte de ley. ¿Se aplicó la migración 004?");
  }

  const admin = crearCliente(base);
  const loginAdmin = await admin.pedir("/api/login", {
    method: "POST",
    body: { username: "admin_prueba", password: "Password123" },
  });
  check("login admin_prueba", loginAdmin.status, 200);

  const perfiles = await ejecutar(admin, "Security", "User", "listarPerfiles");
  check("listarPerfiles", perfiles.status, 200);
  const perfilEmpleado = perfiles.body.find((perfil) => perfil.nombre === "Empleado");
  check("perfil Empleado existe", Boolean(perfilEmpleado), true);

  const cargos = await ejecutar(admin, "Security", "User", "listarCargos");
  check("listarCargos", cargos.status, 200);
  check("hay cargos sembrados", cargos.body.length > 0, true);

  const personas = await ejecutar(admin, "Security", "User", "listarPersonas");
  check("listarPersonas (migración 005)", personas.status, 200);

  const alta = await ejecutar(admin, "Security", "User", "registrar", [
    {
      cedula: CEDULA,
      primer_nombre: "E2E",
      primer_apellido: "Nomina",
      email: EMAIL,
      username: USERNAME,
      password: CLAVE,
      perfiles: [perfilEmpleado.id],
      laboral: {
        cargo_id: cargos.body[0].id,
        fecha_inicio: FECHA_CONTRATO,
        tipo_pago: "POR_HORA",
        frecuencia_pago: "SEMANAL",
        monto: 10,
        horas_semanales: 40,
      },
    },
  ]);
  check("registrar empleado con contrato", alta.status, 200);
  const personaId = alta.body.persona_id;
  check("persona_id devuelto", typeof personaId, "string");

  for (const tipo of tipos) {
    const afiliacion = await ejecutar(admin, "Payroll", "Affiliation", "registrar", [
      personaId,
      tipo.id,
      `E2E-${tipo.codigo}`,
      FECHA_CONTRATO,
    ]);
    check(`afiliación ${tipo.codigo}`, afiliacion.status, 200);
  }

  const conceptos = await ejecutar(admin, "Payroll", "Concept", "listar");
  check("listar conceptos", conceptos.status, 200);
  const bono = conceptos.body.find((concepto) => concepto.codigo === "BONO");
  check("concepto BONO existe", Boolean(bono), true);

  const recurrente = await ejecutar(admin, "Payroll", "Concept", "asignarRecurrente", [
    personaId,
    bono.id,
    100,
    PERIODO.inicio,
    "MONTO_FIJO",
  ]);
  check("asignar bono recurrente", recurrente.status, 200);

  const horas = await ejecutar(admin, "Payroll", "Hours", "registrar", [
    personaId,
    FECHA_HORAS,
    40,
    5,
    "E2E",
  ]);
  check("registrar horas", horas.status, 200);

  const prestamo = await ejecutar(admin, "Payroll", "Loan", "crear", [
    personaId,
    "2031-03-01",
    100,
    2,
    0.10,
  ]);
  check("crear préstamo", prestamo.status, 200);
  check("cuotas del préstamo", prestamo.body.cuotas.length, 2);

  const { rows: contratos } = await db.query(
    `SELECT count(*)::int AS n
       FROM contrato c
       JOIN persona p ON p.id = c.persona_id
      WHERE c.estado = 'VIGENTE'
        AND c.frecuencia_pago = $1
        AND c.fecha_inicio <= $3
        AND (c.fecha_fin IS NULL OR c.fecha_fin >= $2)
        AND p.estado = 'ACTIVO'`,
    [PERIODO.frecuencia, PERIODO.inicio, PERIODO.fin],
  );
  if (contratos[0].n !== 1) {
    throw new Error(
      `Hay ${contratos[0].n} contratos semanales vigentes en el período. ` +
        "El E2E debe correr en un branch desechable.",
    );
  }

  const periodo = await ejecutar(admin, "Payroll", "Period", "crear", [
    PERIODO.frecuencia,
    PERIODO.inicio,
    PERIODO.fin,
    PERIODO.descripcion,
  ]);
  check("crear período", periodo.status, 200);
  const periodoId = periodo.body.id;

  const procesado = await ejecutar(admin, "Payroll", "Period", "procesar", [periodoId]);
  check("procesar período", procesado.status, 200);
  check("estado PROCESADO", procesado.body.periodo.estado, "PROCESADO");
  check("un recibo", procesado.body.recibos.length, 1);

  const lista = await ejecutar(admin, "Payroll", "Receipt", "listarPorPeriodo", [periodoId]);
  check("listar recibos del período", lista.status, 200);
  const recibo = lista.body.find((fila) => fila.persona_id === personaId);
  check("recibo del empleado", Boolean(recibo), true);
  reciboId = recibo.id;
  check("total asignaciones", recibo.total_asignaciones, "575.00");
  check("total deducciones", recibo.total_deducciones, "86.63");
  check("neto", recibo.monto_total, "488.37");

  const desgloseAdmin = await ejecutar(admin, "Payroll", "Receipt", "ver", [reciboId]);
  check("ver recibo", desgloseAdmin.status, 200);
  const porCodigo = new Map(
    desgloseAdmin.body.detalle.map((linea) => [linea.codigo, linea.monto]),
  );
  check("sueldo base", porCodigo.get("SUELDO_BASE"), "400.00");
  check("hora extra", porCodigo.get("HORA_EXTRA"), "75.00");
  check("bono", porCodigo.get("BONO"), "100.00");
  check("SSO empleado", porCodigo.get("SSO"), "23.00");
  check("paro forzoso", porCodigo.get("PARO_FORZOSO"), "2.88");
  check("FAOV empleado", porCodigo.get("FAOV"), "5.75");
  check("cuota préstamo", porCodigo.get("CUOTA_PRESTAMO"), "55.00");
  check("SSO patronal", porCodigo.get("SSO_PATRONAL"), "51.75");
  check("paro patronal", porCodigo.get("PARO_FORZOSO_PATRONAL"), "11.50");
  check("FAOV patronal", porCodigo.get("FAOV_PATRONAL"), "11.50");

  const pagado = await ejecutar(admin, "Payroll", "Period", "pagar", [
    periodoId,
    "2031-03-10",
    "TRANSFERENCIA",
    "E2E-REF",
  ]);
  check("pagar período", pagado.status, 200);
  check("estado PAGADO", pagado.body.periodo.estado, "PAGADO");
  check("un recibo pagado", pagado.body.recibosPagados, 1);

  const empleado = crearCliente(base);
  const loginEmpleado = await empleado.pedir("/api/login", {
    method: "POST",
    body: { username: USERNAME, password: CLAVE },
  });
  check("login empleado", loginEmpleado.status, 200);

  const bloqueado = await ejecutar(empleado, "Payroll", "Receipt", "misRecibos");
  check("bloqueado por cambio de clave", bloqueado.status, 403);

  const cambio = await ejecutar(empleado, "Security", "User", "cambiarClave", [CLAVE, CLAVE]);
  check("cambiar clave", cambio.status, 200);

  const misRecibos = await ejecutar(empleado, "Payroll", "Receipt", "misRecibos");
  check("misRecibos", misRecibos.status, 200);
  check("un recibo propio", misRecibos.body.length, 1);

  const miDesglose = await ejecutar(empleado, "Payroll", "Receipt", "miDesglose", [reciboId]);
  check("miDesglose", miDesglose.status, 200);
  check("detalle propio", miDesglose.body.detalle.length > 0, true);

  const prohibido = await ejecutar(empleado, "Payroll", "Period", "procesar", [periodoId]);
  check("empleado no procesa", prohibido.status, 403);

  const misHoras = await ejecutar(empleado, "Payroll", "Hours", "misHoras", [
    PERIODO.inicio,
    PERIODO.fin,
  ]);
  check("misHoras", misHoras.status, 200);
  check("una carga de horas", misHoras.body.length, 1);
} finally {
  await limpiar();
  check("sin residuos de usuario", (await db.query("SELECT count(*)::int AS n FROM usuario WHERE username = $1", [USERNAME])).rows[0].n, 0);
  await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
}

console.table(casos);
console.log("PAYROLL E2E OK");
process.exit(0);
