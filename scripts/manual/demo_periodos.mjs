// Deja los períodos sembrados por db/seed-datos-prueba.sql con historial:
//
//   1. Procesa y PAGA "Semana 1 de octubre 2026" → recibos PAGADO.
//   2. Procesa en orden cronológico los mensuales, quincenales y la semana 3
//      de noviembre hasta los nuevos períodos de diciembre. Las cuotas se
//      descuentan en su período y admin_prueba entra en las quincenas nuevas
//      porque el seed le dio contrato de empleado.
//   3. Genera la pre-nómina de "Semana 4 de noviembre 2026" y la deja en
//      borrador, lista para abrir en /payroll/pre-nomina. La quincena 1 de
//      noviembre ya está PROCESADA y no admite un borrador.
//
// Usa los objetos de negocio reales (no SQL a mano), así los montos son los
// mismos que produciría la app. Idempotente: si el período ya no está
// BORRADOR lo salta, y si ya hay borrador no lo regenera.
//
//   node scripts/manual/demo_periodos.mjs --yes
//
// Escribe en la BD de DATABASE_URL. Solo desarrollo.
import "./_guard.mjs";
import { db } from "../../src/database/Database.js";
import { Period } from "../../src/bo/Payroll/Period.js";
import { PreNomina } from "../../src/bo/Payroll/PreNomina.js";

const DESCRIPCION_SEMANAL_PAGADA = "Semana 1 de octubre 2026";
// En orden cronológico dentro de cada frecuencia: cada período descuenta las
// cuotas que vencen en él.
const SEMANALES_A_PROCESAR = ["Semana 3 de noviembre 2026"];
const MENSUALES_A_PROCESAR = ["Septiembre 2026", "Diciembre 2026"];
const QUINCENALES_A_PROCESAR = [
  "Quincena 2 de septiembre 2026",
  "Quincena 1 de octubre 2026",
  "Quincena 2 de octubre 2026",
  "Quincena 1 de noviembre 2026",
  "Quincena 2 de noviembre 2026",
  "Quincena 1 de diciembre 2026",
];
const DESCRIPCION_BORRADOR = "Semana 4 de noviembre 2026";
const FECHA_PAGO = "2026-10-12";
const METODO_PAGO = "TRANSFERENCIA";

const { rows: usuarios } = await db.query(
  "SELECT id FROM usuario WHERE username = $1",
  ["admin_prueba"],
);
const admin = usuarios[0];
if (!admin) {
  console.error("Falta el usuario admin_prueba: corre db/seed-usuario-prueba.sql.");
  process.exit(1);
}

const req = { session: { userID: admin.id } };
const periodos = new Period(db, req);
const preNomina = new PreNomina(db, req);

const porDescripcion = async (descripcion) => {
  const lista = await periodos.listar();
  const periodo = lista.find((fila) => fila.descripcion === descripcion);
  if (!periodo) {
    throw new Error(`No existe el período "${descripcion}". Corre db/seed-datos-prueba.sql.`);
  }
  return periodo;
};

const procesar = async (descripcion) => {
  const periodo = await porDescripcion(descripcion);
  if (periodo.estado !== "BORRADOR") {
    console.log(`· "${descripcion}" ya está ${periodo.estado}: no se toca.`);
    return periodo;
  }
  const { recibos } = await periodos.procesar(periodo.id);
  console.log(`✓ "${descripcion}" procesado: ${recibos.length} recibo(s).`);
  return { ...periodo, estado: "PROCESADO" };
};

// 1. Semana 1 de octubre: procesada y pagada.
const semanal = await procesar(DESCRIPCION_SEMANAL_PAGADA);
if (semanal.estado === "PROCESADO") {
  const { recibosPagados } = await periodos.pagar(semanal.id, FECHA_PAGO, METODO_PAGO);
  console.log(`✓ "${DESCRIPCION_SEMANAL_PAGADA}" pagado: ${recibosPagados} recibo(s).`);
} else {
  console.log(`· "${DESCRIPCION_SEMANAL_PAGADA}" ya está ${semanal.estado}: no se paga.`);
}

// 2. Resto de períodos con historial, en orden dentro de cada frecuencia.
for (const descripcion of SEMANALES_A_PROCESAR) {
  await procesar(descripcion);
}
for (const descripcion of MENSUALES_A_PROCESAR) {
  await procesar(descripcion);
}
for (const descripcion of QUINCENALES_A_PROCESAR) {
  await procesar(descripcion);
}

// 3. Semana 4 de noviembre: borrador de pre-nómina listo para editar.
const quincenal = await porDescripcion(DESCRIPCION_BORRADOR);
if (quincenal.preNominaId) {
  console.log(
    `· "${DESCRIPCION_BORRADOR}" ya tiene pre-nómina (${quincenal.preNominaId}): no se regenera.`,
  );
} else {
  const borrador = await preNomina.generar(quincenal.id);
  console.log(
    `✓ Pre-nómina de "${DESCRIPCION_BORRADOR}" generada: ` +
      `${borrador.preNomina.recibos} recibo(s), id ${borrador.preNomina.id}, ` +
      `neto ${borrador.preNomina.montoTotal}.`,
  );
}

await db.pool.end();
process.exit(0);
