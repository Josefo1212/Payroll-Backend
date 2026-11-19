// E2E de solo lectura del resumen de nómina (Payroll/Period/resumen y
// listarConTotales), contra la BD apuntada por DATABASE_URL.
// Requiere las migraciones 001–016 aplicadas y el usuario de prueba
// (db/seed-usuario-prueba.sql).
//
//   node scripts/manual/resumen_e2e.mjs --yes
//
// Toma el período procesado más reciente con recibos, compara el resumen con
// una suma directa en SQL y comprueba que el histórico traiga los mismos
// totales. No escribe filas de nómina.
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

const dos = (valor) => Number(valor ?? 0).toFixed(2);

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

await security.loadPermission();

const server = await new Promise((resolve) => {
  const instancia = app.listen(0, "127.0.0.1", () => resolve(instancia));
});
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const { rows: periodos } = await db.query(
    `SELECT p.id, p.descripcion
       FROM periodo_nomina p
      WHERE p.estado <> 'BORRADOR'
        AND EXISTS (
          SELECT 1 FROM recibo_pago r
           WHERE r.periodo_nomina_id = p.id
             AND r.estado <> 'ANULADO'
        )
      ORDER BY p.fecha_inicio DESC
      LIMIT 1`,
  );
  const periodo = periodos[0];
  if (!periodo) {
    throw new Error(
      "No hay períodos procesados con recibos. Procesá uno (por ejemplo con " +
        "scripts/manual/demo_periodos.mjs) antes de correr este E2E.",
    );
  }

  const { rows: esperado } = await db.query(
    `SELECT COUNT(*)::int AS personas,
            COALESCE(SUM(total_asignaciones), 0) AS asignaciones,
            COALESCE(SUM(total_deducciones), 0) AS deducciones,
            COALESCE(SUM(monto_total), 0) AS neto
       FROM recibo_pago
      WHERE periodo_nomina_id = $1
        AND estado <> 'ANULADO'`,
    [periodo.id],
  );
  const { rows: patronal } = await db.query(
    `SELECT COALESCE(SUM(d.monto), 0) AS total
       FROM detalle_recibo d
       JOIN concepto co ON co.id = d.concepto_id
       JOIN recibo_pago r ON r.id = d.recibo_pago_id
      WHERE r.periodo_nomina_id = $1
        AND r.estado <> 'ANULADO'
        AND co.tipo_concepto = 'APORTE_PATRONAL'`,
    [periodo.id],
  );

  const admin = crearCliente(base);
  const login = await admin.pedir("/api/login", {
    method: "POST",
    body: { username: "admin_prueba", password: "Password123" },
  });
  check("login admin_prueba", login.status, 200);

  const resumen = await ejecutar(admin, "Payroll", "Period", "resumen", [
    periodo.id,
  ]);
  check("resumen status", resumen.status, 200);
  check("mismo período", resumen.body.periodo.id, periodo.id);
  check("personas", resumen.body.totales.personas, esperado[0].personas);
  check(
    "total asignaciones",
    resumen.body.totales.total_asignaciones,
    dos(esperado[0].asignaciones),
  );
  check(
    "total deducciones",
    resumen.body.totales.total_deducciones,
    dos(esperado[0].deducciones),
  );
  check("total neto", resumen.body.totales.total_neto, dos(esperado[0].neto));
  check(
    "total aporte patronal",
    resumen.body.totales.total_aporte_patronal,
    dos(patronal[0].total),
  );
  check(
    "costo total",
    resumen.body.totales.costo_total,
    dos(Number(esperado[0].asignaciones) + Number(patronal[0].total)),
  );

  // El desglose por concepto debe cuadrar con los totales por tipo.
  const sumarTipo = (tipo) =>
    resumen.body.por_concepto
      .filter((linea) => linea.tipo_concepto === tipo)
      .reduce((total, linea) => total + Number(linea.total), 0);
  check(
    "conceptos ASIGNACION",
    sumarTipo("ASIGNACION").toFixed(2),
    dos(esperado[0].asignaciones),
  );
  check(
    "conceptos DEDUCCION",
    sumarTipo("DEDUCCION").toFixed(2),
    dos(esperado[0].deducciones),
  );
  check(
    "conceptos APORTE_PATRONAL",
    sumarTipo("APORTE_PATRONAL").toFixed(2),
    dos(patronal[0].total),
  );

  const historico = await ejecutar(admin, "Payroll", "Period", "listarConTotales");
  check("listarConTotales status", historico.status, 200);
  const fila = historico.body.find((fila) => fila.id === periodo.id);
  check("el período aparece en el histórico", Boolean(fila), true);
  check(
    "histórico: personas",
    fila.personas,
    esperado[0].personas,
  );
  check(
    "histórico: neto",
    fila.total_neto,
    dos(esperado[0].neto),
  );
  check(
    "histórico: aporte patronal",
    fila.total_aporte_patronal,
    dos(patronal[0].total),
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
}

console.table(casos);
console.log("RESUMEN E2E OK");
process.exit(0);
