// E2E del registro de personas y despidos (Payroll/Employee) por HTTP, contra
// la BD apuntada por DATABASE_URL. Requiere las migraciones 001–018, el usuario
// de prueba y el seed de datos de demo.
//
//   node scripts/manual/despidos_e2e.mjs --yes
//
// Crea dos usuarios desechables (uno Empleado y uno Administrador), registra un
// despido real y borra todo lo que creó al final. No procesa períodos: la
// inclusión en la nómina se verifica con la consulta del período y el
// prorrateo con el calculador, para no tocar los recibos de la demo.
import "./_guard.mjs";
import app from "../../src/app.js";
import { security } from "../../src/security/Security.js";
import { db } from "../../src/database/Database.js";
import { queries } from "../../src/bo/Payroll/loader.js";
import { payrollCalculator } from "../../src/services/PayrollCalculator.js";

const SUFIJO = `desp${Date.now()}`;
const CEDULA = `V-9${String(Date.now()).slice(-7)}`;
const EMAIL = `${SUFIJO}@example.com`;
const USERNAME = SUFIJO.slice(0, 20);
const USERNAME_ADMIN = `adm${SUFIJO}`.slice(0, 20);
const FECHA_DESPIDO = new Date().toISOString().slice(0, 10);

// Semana (lunes a domingo) que contiene la fecha del despido. El contrato es
// SEMANAL, así que el período de prueba debe ser esa misma semana.
const PERIODO_PRUEBA = (() => {
  const [anio, mes, dia] = FECHA_DESPIDO.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  const diaSemana = (fecha.getUTCDay() + 6) % 7; // lunes = 0
  const lunes = new Date(fecha);
  lunes.setUTCDate(fecha.getUTCDate() - diaSemana);
  const domingo = new Date(lunes);
  domingo.setUTCDate(lunes.getUTCDate() + 6);
  const iso = (valor) => valor.toISOString().slice(0, 10);
  return { inicio: iso(lunes), fin: iso(domingo) };
})();

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
          ? {
              Cookie: [...cookies]
                .map(([clave, valor]) => `${clave}=${valor}`)
                .join("; "),
            }
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

    return {
      status: respuesta.status,
      body: await respuesta.json().catch(() => null),
    };
  };
  return { pedir };
};

const ejecutar = (cliente, subsystem, clase, method, params = []) =>
  cliente.pedir("/api/execute", {
    method: "POST",
    body: { subsystem, class: clase, method, params },
  });

const login = async (cliente, username) => {
  const respuesta = await cliente.pedir("/api/login", {
    method: "POST",
    body: { username, password: "Password123" },
  });
  check(`login ${username}`, respuesta.status, 200);
  return respuesta;
};

await security.loadPermission();

const server = await new Promise((resolve) => {
  const instancia = app.listen(0, "127.0.0.1", () => resolve(instancia));
});
const base = `http://127.0.0.1:${server.address().port}`;

let personaId = null;
let usuarioId = null;
let contratoId = null;
let adminId = null;

try {
  const { rows: perfiles } = await db.query(
    "SELECT id, nombre_perfil FROM perfil WHERE nombre_perfil IN ('Empleado', 'Administrador')",
  );
  const perfilEmpleado = perfiles.find((fila) => fila.nombre_perfil === "Empleado");
  const perfilAdmin = perfiles.find((fila) => fila.nombre_perfil === "Administrador");
  if (!perfilEmpleado || !perfilAdmin) {
    throw new Error("Faltan los perfiles Empleado o Administrador en la BD.");
  }

  const { rows: cargos } = await db.query(
    "SELECT id FROM cargo WHERE activo = true ORDER BY id LIMIT 1",
  );
  if (!cargos[0]) {
    throw new Error("No hay un cargo activo para crear el contrato de prueba.");
  }

  const admin = crearCliente(base);
  await login(admin, "admin_prueba");

  // 1. Alta de la persona de prueba con contrato SEMANAL.
  const alta = await ejecutar(admin, "Security", "User", "registrar", [
    {
      cedula: CEDULA,
      primer_nombre: "Prueba",
      primer_apellido: "Despido",
      email: EMAIL,
      username: USERNAME,
      password: "Password123",
      perfiles: [perfilEmpleado.id],
      laboral: {
        cargo_id: cargos[0].id,
        fecha_inicio: "2020-01-01",
        tipo_pago: "SALARIO_FIJO",
        frecuencia_pago: "SEMANAL",
        monto: "2600",
      },
    },
  ]);
  check("alta de la persona", alta.status, 200);
  usuarioId = alta.body.id;
  personaId = alta.body.personaId ?? null;

  if (!personaId) {
    const { rows } = await db.query(
      "SELECT persona_id FROM usuario WHERE id = $1",
      [usuarioId],
    );
    personaId = rows[0]?.persona_id ?? null;
  }
  const { rows: contratos } = await db.query(
    "SELECT id FROM contrato WHERE persona_id = $1 AND estado = 'VIGENTE'",
    [personaId],
  );
  contratoId = contratos[0]?.id ?? null;
  check("la persona tiene contrato", Boolean(contratoId), true);

  // 2. La persona inicia sesión: deja sesión y refresh tokens reales.
  const empleado = crearCliente(base);
  await login(empleado, USERNAME);

  const sesionesAntes = await db.query(
    "SELECT count(*)::int AS total FROM sesion WHERE sess->>'userID' = $1",
    [usuarioId],
  );
  const tokensAntes = await db.query(
    "SELECT count(*)::int AS total FROM refresh_token WHERE usuario_id = $1 AND revocado_en IS NULL",
    [usuarioId],
  );
  check("sesiones antes del despido", sesionesAntes.rows[0].total >= 1, true);
  check("tokens activos antes del despido", tokensAntes.rows[0].total >= 1, true);

  // 3. RRHH ve los motivos y el registro.
  const rrhh = crearCliente(base);
  await login(rrhh, "rosa_vargas");

  const motivos = await ejecutar(rrhh, "Payroll", "Employee", "listarMotivos");
  check("listarMotivos", motivos.status, 200);
  check("motivos del enum", motivos.body.length, 6);
  check("incluye RENUNCIA", motivos.body.includes("RENUNCIA"), true);

  const listado = await ejecutar(rrhh, "Payroll", "Employee", "listar", ["ACTIVO"]);
  check("listar activos", listado.status, 200);
  check(
    "la persona de prueba aparece activa",
    listado.body.some((fila) => fila.id === personaId && fila.estado === "ACTIVO"),
    true,
  );

  // 4. Despido transaccional.
  const despido = await ejecutar(rrhh, "Payroll", "Employee", "despedir", [
    personaId,
    "RENUNCIA",
    FECHA_DESPIDO,
    "  Renuncia voluntaria de prueba  ",
  ]);
  check("despedir", despido.status, 200);
  check("contrato finalizado", despido.body.contrato.estado, "FINALIZADO");
  check("fecha de fin del contrato", despido.body.contrato.fecha_fin, FECHA_DESPIDO);
  check("descripción recortada", despido.body.despido.descripcion, "Renuncia voluntaria de prueba");
  check("usuario desactivado", despido.body.usuarioDesactivado, true);
  check("sesiones cerradas", despido.body.sesionesCerradas >= 1, true);
  check("tokens revocados", despido.body.tokensRevocados >= 1, true);

  // 5. Verificación directa en la BD.
  const { rows: estado } = await db.query(
    `SELECT p.estado AS persona_estado, u.activo AS usuario_activo,
            c.estado AS contrato_estado, c.fecha_fin::text AS contrato_fin,
            d.motivo, d.descripcion
       FROM persona p
       JOIN usuario u ON u.persona_id = p.id
       JOIN contrato c ON c.id = $2
       JOIN despido d ON d.contrato_id = c.id
      WHERE p.id = $1`,
    [personaId, contratoId],
  );
  check("persona INACTIVO", estado[0]?.persona_estado, "INACTIVO");
  check("usuario inactivo", estado[0]?.usuario_activo, false);
  check("contrato FINALIZADO", estado[0]?.contrato_estado, "FINALIZADO");
  check("contrato con fecha de fin", estado[0]?.contrato_fin, FECHA_DESPIDO);
  check("motivo guardado", estado[0]?.motivo, "RENUNCIA");

  const sesionesDespues = await db.query(
    "SELECT count(*)::int AS total FROM sesion WHERE sess->>'userID' = $1",
    [usuarioId],
  );
  const tokensDespues = await db.query(
    "SELECT count(*)::int AS total FROM refresh_token WHERE usuario_id = $1 AND revocado_en IS NULL",
    [usuarioId],
  );
  check("sin sesiones después del despido", sesionesDespues.rows[0].total, 0);
  check("sin tokens activos después del despido", tokensDespues.rows[0].total, 0);

  // 6. La persona despedida sigue entrando a la nómina del período en que cae
  // su fecha_fin (sin procesar el período, para no tocar la demo).
  const { rows: enNomina } = await db.query(queries.findContratosVigentesPorFrecuencia, [
    PERIODO_PRUEBA.inicio,
    PERIODO_PRUEBA.fin,
    "SEMANAL",
  ]);
  const filaNomina = enNomina.find((fila) => fila.persona_id === personaId);
  check("la persona despedida entra a la nómina del período", Boolean(filaNomina), true);

  const prorrateado = payrollCalculator.sueldoPeriodoProporcional(
    "2600",
    "SEMANAL",
    {
      inicioPeriodo: PERIODO_PRUEBA.inicio,
      finPeriodo: PERIODO_PRUEBA.fin,
      inicioContrato: "2020-01-01",
      finContrato: FECHA_DESPIDO,
    },
  );
  // Días trabajados de la semana × sueldo semanal / 7 (2600 × 12 / 52).
  const dias = payrollCalculator.diasInclusivos(PERIODO_PRUEBA.inicio, FECHA_DESPIDO);
  const esperado = (600 * (dias / 7)).toFixed(2);
  check("sueldo semanal prorrateado", prorrateado.toFixed(2), esperado);

  // 7. Ver e histórico.
  const detalle = await ejecutar(rrhh, "Payroll", "Employee", "ver", [personaId]);
  check("ver persona", detalle.status, 200);
  check("detalle con despido", detalle.body.despidos.length, 1);
  check("detalle con contrato finalizado", detalle.body.contratos[0]?.estado, "FINALIZADO");

  const historico = await ejecutar(rrhh, "Payroll", "Employee", "listarDespidos");
  check("listarDespidos", historico.status, 200);
  check(
    "el despido aparece en el histórico",
    historico.body.some((fila) => fila.persona_id === personaId),
    true,
  );

  // 8. Guardas: segundo despido y validaciones.
  const repetido = await ejecutar(rrhh, "Payroll", "Employee", "despedir", [
    personaId,
    "RENUNCIA",
    FECHA_DESPIDO,
  ]);
  check("segundo despido", repetido.status, 409);

  const motivoInvalido = await ejecutar(rrhh, "Payroll", "Employee", "despedir", [
    personaId,
    "DESPIDO",
    FECHA_DESPIDO,
  ]);
  check("motivo inválido", motivoInvalido.status, 400);

  const futura = await ejecutar(rrhh, "Payroll", "Employee", "despedir", [
    personaId,
    "RENUNCIA",
    "2999-01-01",
  ]);
  check("fecha futura", futura.status, 400);

  const inexistente = await ejecutar(rrhh, "Payroll", "Employee", "ver", [
    "99999999-9999-4999-8999-999999999999",
  ]);
  check("persona inexistente", inexistente.status, 404);

  // 9. Un Empleado no ejecuta los métodos.
  const empleadoAjeno = crearCliente(base);
  await login(empleadoAjeno, "luis_gomez");
  const empleadoLista = await ejecutar(empleadoAjeno, "Payroll", "Employee", "listar");
  check("Empleado listar 403", empleadoLista.status, 403);
  const empleadoDespide = await ejecutar(
    empleadoAjeno,
    "Payroll",
    "Employee",
    "despedir",
    [personaId, "RENUNCIA", FECHA_DESPIDO],
  );
  check("Empleado despedir 403", empleadoDespide.status, 403);

  // 10. Un Administrador (sin Superusuario ni RRHH) tampoco.
  const altaAdmin = await ejecutar(admin, "Security", "User", "registrar", [
    {
      cedula: `V-8${String(Date.now()).slice(-7)}`,
      primer_nombre: "Admin",
      primer_apellido: "Prueba",
      email: `admin-${EMAIL}`,
      username: USERNAME_ADMIN,
      password: "Password123",
      perfiles: [perfilAdmin.id],
    },
  ]);
  check("alta del administrador de prueba", altaAdmin.status, 200);
  adminId = altaAdmin.body.id;

  const adminCliente = crearCliente(base);
  await login(adminCliente, USERNAME_ADMIN);
  const adminLista = await ejecutar(adminCliente, "Payroll", "Employee", "listar");
  check("Administrador listar 403", adminLista.status, 403);
  const adminDespide = await ejecutar(
    adminCliente,
    "Payroll",
    "Employee",
    "despedir",
    [personaId, "RENUNCIA", FECHA_DESPIDO],
  );
  check("Administrador despedir 403", adminDespide.status, 403);

  // 11. Sin sesión.
  const anonimo = crearCliente(base);
  const sinSesion = await ejecutar(anonimo, "Payroll", "Employee", "listar");
  check("sin sesión", sinSesion.status, 401);
} finally {
  if (personaId) {
    await db.query("DELETE FROM despido WHERE persona_id = $1", [personaId]);
    await db.query(
      "DELETE FROM contrato_salario WHERE contrato_id IN (SELECT id FROM contrato WHERE persona_id = $1)",
      [personaId],
    );
    await db.query("DELETE FROM contrato WHERE persona_id = $1", [personaId]);
    await db.query(
      "DELETE FROM refresh_token WHERE usuario_id IN (SELECT id FROM usuario WHERE persona_id = $1)",
      [personaId],
    );
    await db.query(
      "DELETE FROM sesion WHERE sess->>'userID' IN (SELECT id::text FROM usuario WHERE persona_id = $1)",
      [personaId],
    );
    await db.query(
      "DELETE FROM usuario_perfil WHERE usuario_id IN (SELECT id FROM usuario WHERE persona_id = $1)",
      [personaId],
    );
    await db.query("DELETE FROM usuario WHERE persona_id = $1", [personaId]);
    await db.query("DELETE FROM persona WHERE id = $1", [personaId]);
  }
  if (adminId) {
    await db.query(
      "DELETE FROM refresh_token WHERE usuario_id = $1",
      [adminId],
    );
    await db.query(
      "DELETE FROM sesion WHERE sess->>'userID' = $1",
      [String(adminId)],
    );
    await db.query("DELETE FROM usuario_perfil WHERE usuario_id = $1", [adminId]);
    const { rows } = await db.query("SELECT persona_id FROM usuario WHERE id = $1", [
      adminId,
    ]);
    await db.query("DELETE FROM usuario WHERE id = $1", [adminId]);
    if (rows[0]?.persona_id) {
      await db.query("DELETE FROM persona WHERE id = $1", [rows[0].persona_id]);
    }
  }

  await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
}

console.table(casos);
console.log("DESPIDOS E2E OK");
process.exit(0);
