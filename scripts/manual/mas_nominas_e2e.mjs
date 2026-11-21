// E2E de solo lectura de la ampliación de datos de prueba (spec 016):
// más períodos y admin_prueba dado de alta como empleado con recibos propios.
// Requiere que se hayan corrido db/seed-datos-prueba.sql y
// scripts/manual/demo_periodos.mjs --yes sobre la BD apuntada por DATABASE_URL.
//
//   node scripts/manual/mas_nominas_e2e.mjs --yes
//
// No escribe filas: sólo consulta por SQL y por el endpoint /execute con un
// login real de admin_prueba, incluido el perfil Empleado y su PDF.
import "./_guard.mjs";
import app from "../../src/app.js";
import { security } from "../../src/security/Security.js";
import { db } from "../../src/database/Database.js";

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
          ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const linea of respuesta.headers.getSetCookie?.() ?? []) {
      const par = linea.split(";")[0];
      const corte = par.indexOf("=");
      const clave = par.slice(0, corte);
      const valor = par.slice(corte + 1);
      if (valor === "") {
        cookies.delete(clave);
      } else {
        cookies.set(clave, valor);
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

const NUEVOS = [
  "Semana 3 de noviembre 2026",
  "Semana 4 de noviembre 2026",
  "Semana 1 de diciembre 2026",
  "Semana 2 de diciembre 2026",
  "Quincena 2 de noviembre 2026",
  "Quincena 1 de diciembre 2026",
  "Diciembre 2026",
];

await security.loadPermission();

const server = await new Promise((resolve) => {
  const instancia = app.listen(0, "127.0.0.1", () => resolve(instancia));
});
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const { rows: identidad } = await db.query(
    `SELECT p.id AS persona_id,
            (SELECT id FROM perfil WHERE nombre_perfil = 'Empleado') AS perfil_empleado_id
       FROM usuario u
       JOIN persona p ON p.id = u.persona_id
      WHERE u.username = 'admin_prueba'`,
  );
  check("existe admin_prueba", identidad.length, 1);
  const { persona_id: personaId, perfil_empleado_id: perfilEmpleadoId } = identidad[0];
  check("existe el perfil Empleado", typeof perfilEmpleadoId, "number");

  const { rows: laboral } = await db.query(
    `SELECT c.frecuencia_pago::text AS frecuencia,
            cs.monto::text AS monto,
            (SELECT count(*)::int FROM afiliacion_ley a
              WHERE a.persona_id = $1 AND a.estado = 'ACTIVO') AS afiliaciones,
            (SELECT count(*)::int FROM cuenta_bancaria cb
              WHERE cb.persona_id = $1 AND cb.es_principal AND cb.activa) AS cuentas,
            (SELECT count(*)::int FROM concepto_persona cp
              WHERE cp.persona_id = $1) AS recurrentes
       FROM contrato c
       JOIN contrato_salario cs ON cs.contrato_id = c.id
      WHERE c.persona_id = $1
        AND c.estado = 'VIGENTE'
        AND cs.vigente_hasta IS NULL`,
    [personaId],
  );
  const alta = laboral[0] ?? {};
  check("contrato quincenal", alta.frecuencia, "QUINCENAL");
  check("salario mensual", alta.monto, "15000.00");
  check("afiliaciones de ley", alta.afiliaciones, 4);
  check("cuenta principal", alta.cuentas, 1);
  check("concepto recurrente", alta.recurrentes, 1);

  const { rows: periodos } = await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE descripcion = ANY($1::text[]))::int AS nuevos,
            count(*) FILTER (WHERE estado = 'BORRADOR')::int AS borradores
       FROM periodo_nomina`,
    [NUEVOS],
  );
  check("períodos totales", periodos[0].total, 20);
  check("períodos nuevos", periodos[0].nuevos, 7);
  check("períodos aún en borrador", periodos[0].borradores, 7);

  const { rows: borrador } = await db.query(
    `SELECT count(*)::int AS total
       FROM pre_nomina pr
       JOIN periodo_nomina pn ON pn.id = pr.periodo_nomina_id
      WHERE pn.descripcion = 'Semana 4 de noviembre 2026'`,
  );
  check("pre-nómina de ejemplo", borrador[0].total, 1);

  const { rows: recibosDb } = await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE pn.fecha_inicio = DATE '2026-11-16')::int AS quincena_nov,
            count(*) FILTER (WHERE pn.fecha_inicio = DATE '2026-12-01'
                               AND pn.frecuencia = 'QUINCENAL')::int AS quincena_dic
       FROM recibo_pago r
       JOIN periodo_nomina pn ON pn.id = r.periodo_nomina_id
      WHERE r.persona_id = $1
        AND r.estado <> 'ANULADO'`,
    [personaId],
  );
  check("recibos propios de admin_prueba", recibosDb[0], {
    total: 2,
    quincena_nov: 1,
    quincena_dic: 1,
  });

  const cliente = crearCliente(base);
  const login = await cliente.pedir("/api/login", {
    method: "POST",
    body: { username: "admin_prueba", password: "Password123" },
  });
  check("login admin_prueba", login.status, 200);

  const mios = await ejecutar(cliente, "Payroll", "Receipt", "misRecibos");
  check("misRecibos status", mios.status, 200);
  check("misRecibos devuelve 2", mios.body?.length, 2);
  check("todos los recibos son suyos", mios.body.every((r) => r.persona_id === personaId), true);
  check("montos positivos", mios.body.every((r) => Number(r.monto_total) > 0), true);

  const pdf = await ejecutar(cliente, "Payroll", "Receipt", "generarPdf", [mios.body[0].id]);
  check("generarPdf status", pdf.status, 200);
  check("generarPdf mime", pdf.body?.mimeType, "application/pdf");
  check("generarPdf base64", pdf.body?.contenidoBase64?.length > 1000, true);

  const menu = await ejecutar(cliente, "Security", "Menu", "getOptions", [perfilEmpleadoId]);
  check("getOptions Empleado status", menu.status, 200);
  check("el perfil Empleado ve MisRecibos", menu.body.some((o) => o.nombre === "MisRecibos"), true);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
}

console.table(casos);
console.log("MAS NOMINAS E2E OK");
process.exit(0);
