// E2E de la pre-nómina (spec 012) por HTTP, contra la BD apuntada por
// DATABASE_URL. Requiere las migraciones 001–014 aplicadas y el usuario de
// prueba (db/seed-usuario-prueba.sql). Escribe en la BD: usar un branch
// desechable.
//
//   node scripts/manual/pre_nomina_e2e.mjs --yes
//
// Flujo: login RRHH/Superusuario → empleado con contrato → afiliaciones →
// descuento recurrente → horas → préstamo → novedad aprobada → período →
// generar → ver → eliminar/regenerar → guardar → confirmar → pagar → el
// empleado ve su recibo. Limpia sus datos al final.
import "./_guard.mjs";
import Decimal from "decimal.js";
import app from "../../src/app.js";
import { security } from "../../src/security/Security.js";
import { db } from "../../src/database/Database.js";

const CEDULA = "E2E-PRE-001";
const USERNAME = "e2e_pre_001";
const EMAIL = "e2e.pre.001@example.test";
const CLAVE = "E2eClave123";
const CEDULA_ADMIN = "E2E-PRE-ADM";
const USERNAME_ADMIN = "e2e_pre_adm";
const EMAIL_ADMIN = "e2e.pre.adm@example.test";
const FECHA_CONTRATO = "2026-01-01";
const FECHA_HORAS = "2031-04-02";
const FECHA_NOVEDAD = "2031-04-03";
const FECHA_PRESTAMO = "2031-03-30";
const PERIODO = {
  frecuencia: "SEMANAL",
  inicio: "2031-04-01",
  fin: "2031-04-07",
  descripcion: "E2E pre-nomina semanal",
};
const FECHA_PAGO = "2031-04-08";

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

const limpiar = async () => {
  const pares = [
    { cedula: CEDULA, username: USERNAME },
    { cedula: CEDULA_ADMIN, username: USERNAME_ADMIN },
  ];
  const usuarios = new Map();
  const personas = new Map();

  for (const par of pares) {
    const { rows } = await db.query(
      "SELECT id, persona_id FROM usuario WHERE username = $1",
      [par.username],
    );
    if (rows[0]) {
      usuarios.set(par.username, rows[0].id);
      personas.set(par.username, rows[0].persona_id);
      continue;
    }
    const { rows: encontradas } = await db.query(
      "SELECT id FROM persona WHERE cedula = $1",
      [par.cedula],
    );
    personas.set(par.username, encontradas[0]?.id ?? null);
  }

  const { rows: periodos } = await db.query(
    `SELECT id FROM periodo_nomina
      WHERE frecuencia = $1 AND fecha_inicio = $2 AND fecha_fin = $3`,
    [PERIODO.frecuencia, PERIODO.inicio, PERIODO.fin],
  );

  for (const periodo of periodos) {
    await db.query("DELETE FROM pre_nomina WHERE periodo_nomina_id = $1", [
      periodo.id,
    ]);
    await db.query(
      "DELETE FROM detalle_recibo WHERE recibo_pago_id IN (SELECT id FROM recibo_pago WHERE periodo_nomina_id = $1)",
      [periodo.id],
    );
    await db.query("DELETE FROM recibo_pago WHERE periodo_nomina_id = $1", [
      periodo.id,
    ]);
    await db.query("DELETE FROM novedad WHERE periodo_nomina_id = $1", [
      periodo.id,
    ]);
    await db.query("DELETE FROM periodo_nomina WHERE id = $1", [periodo.id]);
  }

  const idsUsuarios = [...usuarios.values()];
  if (idsUsuarios.length > 0) {
    await db.query(
      "DELETE FROM pre_nomina WHERE generado_por = ANY($1::uuid[]) OR actualizado_por = ANY($1::uuid[])",
      [idsUsuarios],
    );
  }

  for (const [username, personaId] of personas) {
    if (!personaId) {
      continue;
    }
    await db.query(
      "DELETE FROM detalle_recibo WHERE recibo_pago_id IN (SELECT id FROM recibo_pago WHERE persona_id = $1)",
      [personaId],
    );
    await db.query("DELETE FROM recibo_pago WHERE persona_id = $1", [personaId]);
    await db.query("DELETE FROM novedad WHERE persona_id = $1", [personaId]);
    await db.query("DELETE FROM concepto_persona WHERE persona_id = $1", [
      personaId,
    ]);
    await db.query("DELETE FROM afiliacion_ley WHERE persona_id = $1", [
      personaId,
    ]);
    await db.query("DELETE FROM registro_horas WHERE persona_id = $1", [
      personaId,
    ]);
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

  for (const [username, usuarioId] of usuarios) {
    await db.query("DELETE FROM refresh_token WHERE usuario_id = $1", [
      usuarioId,
    ]);
    await db.query("DELETE FROM usuario_perfil WHERE usuario_id = $1", [
      usuarioId,
    ]);
    await db.query("DELETE FROM usuario WHERE id = $1", [usuarioId]);
  }

  for (const [, personaId] of personas) {
    if (personaId) {
      await db.query("DELETE FROM persona WHERE id = $1", [personaId]);
    }
  }
};

const lineaPorCodigo = (lineas, codigo, origen = null) =>
  lineas.find(
    (linea) => linea.codigo === codigo && (origen == null || linea.origen === origen),
  );

const lineasEditables = (borrador) =>
  borrador.recibos.flatMap((recibo) =>
    recibo.lineas.filter((linea) => linea.editable),
  );

await security.loadPermission();

const server = await new Promise((resolve) => {
  const instancia = app.listen(0, "127.0.0.1", () => resolve(instancia));
});
const base = `http://127.0.0.1:${server.address().port}`;

let preNominaId = null;

try {
  const choque = await db.query(
    `SELECT descripcion FROM periodo_nomina
      WHERE frecuencia = $1 AND fecha_inicio = $2 AND fecha_fin = $3`,
    [PERIODO.frecuencia, PERIODO.inicio, PERIODO.fin],
  );
  if (
    choque.rows[0] &&
    !String(choque.rows[0].descripcion ?? "").startsWith("E2E")
  ) {
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
    throw new Error(
      "Faltan los tipos de aporte de ley. ¿Se aplicó la migración 004?",
    );
  }

  const admin = crearCliente(base);
  const loginAdmin = await admin.pedir("/api/login", {
    method: "POST",
    body: { username: "admin_prueba", password: "Password123" },
  });
  check("login admin_prueba", loginAdmin.status, 200);

  const perfiles = await ejecutar(admin, "Security", "User", "listarPerfiles");
  check("listarPerfiles", perfiles.status, 200);
  const perfilEmpleado = perfiles.body.find(
    (perfil) => perfil.nombre === "Empleado",
  );
  const perfilAdmin = perfiles.body.find(
    (perfil) => perfil.nombre === "Administrador",
  );
  const perfilRrhh = perfiles.body.find((perfil) => perfil.nombre === "RRHH");
  const perfilSuper = perfiles.body.find(
    (perfil) => perfil.nombre === "Superusuario",
  );
  check("perfil Empleado existe", Boolean(perfilEmpleado), true);
  check("perfil Administrador existe", Boolean(perfilAdmin), true);
  check("perfil RRHH existe", Boolean(perfilRrhh), true);
  check("perfil Superusuario existe", Boolean(perfilSuper), true);

  const opcionesSuper = await ejecutar(admin, "Security", "Menu", "getOptions", [
    perfilSuper.id,
  ]);
  check("getOptions Superusuario", opcionesSuper.status, 200);
  check(
    "Superusuario ve PreNomina",
    opcionesSuper.body.some((opcion) => opcion.nombre === "PreNomina"),
    true,
  );

  const opcionesRrhh = await ejecutar(admin, "Security", "Menu", "getOptions", [
    perfilRrhh.id,
  ]);
  check("getOptions RRHH", opcionesRrhh.status, 200);
  check(
    "RRHH ve PreNomina",
    opcionesRrhh.body.some((opcion) => opcion.nombre === "PreNomina"),
    true,
  );

  const opcionesAdmin = await ejecutar(
    admin,
    "Security",
    "Menu",
    "getOptions",
    [perfilAdmin.id],
  );
  check("getOptions Administrador", opcionesAdmin.status, 200);
  check(
    "Administrador NO ve PreNomina",
    opcionesAdmin.body.some((opcion) => opcion.nombre === "PreNomina"),
    false,
  );

  const cargos = await ejecutar(admin, "Security", "User", "listarCargos");
  check("listarCargos", cargos.status, 200);
  check("hay cargos sembrados", cargos.body.length > 0, true);

  const alta = await ejecutar(admin, "Security", "User", "registrar", [
    {
      cedula: CEDULA,
      primer_nombre: "E2E",
      primer_apellido: "PreNomina",
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
    const afiliacion = await ejecutar(
      admin,
      "Payroll",
      "Affiliation",
      "registrar",
      [personaId, tipo.id, `E2E-${tipo.codigo}`, FECHA_CONTRATO],
    );
    check(`afiliación ${tipo.codigo}`, afiliacion.status, 200);
  }

  const conceptos = await ejecutar(admin, "Payroll", "Concept", "listar");
  check("listar conceptos", conceptos.status, 200);
  const bono = conceptos.body.find((concepto) => concepto.codigo === "BONO");
  const descuento = conceptos.body.find(
    (concepto) => concepto.codigo === "DESCUENTO_OPCIONAL",
  );
  const horaExtra = conceptos.body.find(
    (concepto) => concepto.codigo === "HORA_EXTRA",
  );
  check("concepto BONO existe", Boolean(bono), true);
  check("concepto DESCUENTO_OPCIONAL existe", Boolean(descuento), true);
  check("concepto HORA_EXTRA existe", Boolean(horaExtra), true);

  const recurrente = await ejecutar(
    admin,
    "Payroll",
    "Concept",
    "asignarRecurrente",
    [personaId, descuento.id, 20, PERIODO.inicio, "MONTO_FIJO"],
  );
  check("asignar descuento recurrente", recurrente.status, 200);

  const horas = await ejecutar(admin, "Payroll", "Hours", "registrar", [
    personaId,
    FECHA_HORAS,
    40,
    5,
    "E2E pre-nomina",
  ]);
  check("registrar horas", horas.status, 200);

  const prestamo = await ejecutar(admin, "Payroll", "Loan", "crear", [
    personaId,
    FECHA_PRESTAMO,
    100,
    1,
    0.1,
  ]);
  check("crear préstamo", prestamo.status, 200);
  check("cuotas del préstamo", prestamo.body.cuotas.length, 1);

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

  const novedad = await ejecutar(admin, "Payroll", "Novedad", "registrar", [
    personaId,
    horaExtra.id,
    periodoId,
    FECHA_NOVEDAD,
    3,
  ]);
  check("registrar novedad", novedad.status, 200);
  const novedadId = novedad.body.id;

  const aprobada = await ejecutar(admin, "Payroll", "Novedad", "aprobar", [
    novedadId,
  ]);
  check("aprobar novedad", aprobada.status, 200);
  check("novedad APROBADA", aprobada.body.estado, "APROBADA");

  // --- generar --------------------------------------------------------------
  const generado = await ejecutar(admin, "Payroll", "PreNomina", "generar", [
    periodoId,
  ]);
  check("generar pre-nómina", generado.status, 200);
  let borrador = generado.body;
  preNominaId = borrador.preNomina.id;
  check("version inicial", borrador.preNomina.version, 1);
  check("un recibo en el borrador", borrador.preNomina.recibos, 1);
  check("un recibo detallado", borrador.recibos.length, 1);
  check(
    "neto = asignaciones - deducciones",
    new Decimal(borrador.preNomina.totalAsignaciones)
      .minus(borrador.preNomina.totalDeducciones)
      .toFixed(2),
    borrador.preNomina.montoTotal,
  );
  check("total asignaciones", borrador.preNomina.totalAsignaciones, "520.00");
  check("total deducciones", borrador.preNomina.totalDeducciones, "158.60");
  check("neto del borrador", borrador.preNomina.montoTotal, "361.40");
  check(
    "aporte patronal fuera del neto",
    borrador.preNomina.totalAportePatronal,
    "67.60",
  );

  const lineas = borrador.recibos[0].lineas;
  check(
    "solo CALCULADA/MANUAL son editables",
    lineas
      .filter((linea) => linea.editable)
      .every((linea) => ["CALCULADA", "MANUAL"].includes(linea.origen)),
    true,
  );
  check("dos líneas editables", lineasEditables(borrador).length, 2);
  check(
    "la novedad está bloqueada",
    lineaPorCodigo(lineas, "HORA_EXTRA", "NOVEDAD")?.editable,
    false,
  );
  check(
    "el recurrente está bloqueado",
    lineaPorCodigo(lineas, "DESCUENTO_OPCIONAL", "RECURRENTE")?.editable,
    false,
  );

  // Generar NO aplica nada: novedad, cuota, préstamo y período intactos.
  const { rows: estadoNovedad } = await db.query(
    "SELECT estado FROM novedad WHERE id = $1",
    [novedadId],
  );
  check("generar no aplica la novedad", estadoNovedad[0].estado, "APROBADA");
  const { rows: estadoCuota } = await db.query(
    "SELECT estado FROM cuota_prestamo WHERE prestamo_id = $1 ORDER BY nro_cuota LIMIT 1",
    [prestamo.body.prestamo.id],
  );
  check("generar no descuenta la cuota", estadoCuota[0].estado, "PENDIENTE");
  const { rows: estadoPrestamo } = await db.query(
    "SELECT estado FROM prestamo WHERE id = $1",
    [prestamo.body.prestamo.id],
  );
  check("generar no paga el préstamo", estadoPrestamo[0].estado, "ACTIVO");
  const { rows: estadoPeriodo } = await db.query(
    "SELECT estado FROM periodo_nomina WHERE id = $1",
    [periodoId],
  );
  check("generar no procesa el período", estadoPeriodo[0].estado, "BORRADOR");

  // --- ver ------------------------------------------------------------------
  const visto = await ejecutar(admin, "Payroll", "PreNomina", "ver", [
    preNominaId,
  ]);
  check("ver pre-nómina", visto.status, 200);
  check("ver devuelve el mismo neto", visto.body.preNomina.montoTotal, "361.40");

  // --- eliminar + generar (idempotencia) ------------------------------------
  const eliminado = await ejecutar(admin, "Payroll", "PreNomina", "eliminar", [
    preNominaId,
  ]);
  check("eliminar pre-nómina", eliminado.status, 200);
  check("eliminar devuelve el período", eliminado.body.periodoId, periodoId);

  const { rows: sinBorrador } = await db.query(
    "SELECT count(*)::int AS n FROM pre_nomina WHERE periodo_nomina_id = $1",
    [periodoId],
  );
  check("el borrador ya no existe", sinBorrador[0].n, 0);

  const regenerado = await ejecutar(
    admin,
    "Payroll",
    "PreNomina",
    "generar",
    [periodoId],
  );
  check("regenerar pre-nómina", regenerado.status, 200);
  borrador = regenerado.body;
  preNominaId = borrador.preNomina.id;
  check("regenerar da el mismo neto", borrador.preNomina.montoTotal, "361.40");
  check(
    "regenerar da las mismas líneas",
    borrador.recibos[0].lineas.length,
    lineas.length,
  );

  const duplicado = await ejecutar(admin, "Payroll", "PreNomina", "generar", [
    periodoId,
  ]);
  check("generar dos veces responde 409", duplicado.status, 409);
  check(
    "mensaje de borrador existente",
    duplicado.body.error,
    "El período ya tiene una pre-nómina; elimínala o confírmala.",
  );

  const listaPeriodos = await ejecutar(admin, "Payroll", "Period", "listar");
  check("listar períodos", listaPeriodos.status, 200);
  const filaPeriodo = listaPeriodos.body.find(
    (fila) => fila.id === periodoId,
  );
  check("listar expone el borrador", filaPeriodo.preNominaId, preNominaId);
  check("listar expone la version", filaPeriodo.preNominaVersion, 1);

  // --- guardar --------------------------------------------------------------
  const recibo = borrador.recibos[0];
  const sueldo = lineaPorCodigo(recibo.lineas, "SUELDO_BASE", "CALCULADA");
  const extra = lineaPorCodigo(recibo.lineas, "HORA_EXTRA", "CALCULADA");
  const novedadLinea = lineaPorCodigo(recibo.lineas, "HORA_EXTRA", "NOVEDAD");
  check("existe la línea de sueldo", Boolean(sueldo), true);
  check("existe la línea de extra calculada", Boolean(extra), true);
  check("existe la línea de novedad", Boolean(novedadLinea), true);

  const guardado = await ejecutar(admin, "Payroll", "PreNomina", "guardar", [
    preNominaId,
    1,
    {
      recibos: [
        {
          reciboId: recibo.id,
          lineas: [
            {
              id: sueldo.id,
              monto: "500.00",
              cantidadUnidades: sueldo.cantidadUnidades,
            },
            {
              id: null,
              conceptoId: bono.id,
              monto: "25.00",
              cantidadUnidades: null,
            },
          ],
        },
      ],
    },
  ]);
  check("guardar pre-nómina", guardado.status, 200);
  borrador = guardado.body;
  check("guardar sube la version", borrador.preNomina.version, 2);
  check("total asignaciones tras guardar", borrador.preNomina.totalAsignaciones, "570.00");
  check("total deducciones tras guardar", borrador.preNomina.totalDeducciones, "161.35");
  check("neto tras guardar", borrador.preNomina.montoTotal, "408.65");
  check(
    "aporte patronal tras guardar",
    borrador.preNomina.totalAportePatronal,
    "74.10",
  );

  const lineasGuardadas = borrador.recibos[0].lineas;
  check(
    "la extra calculada se quitó",
    Boolean(lineaPorCodigo(lineasGuardadas, "HORA_EXTRA", "CALCULADA")),
    false,
  );
  const manual = lineasGuardadas.find((linea) => linea.origen === "MANUAL");
  check("la línea manual existe", Boolean(manual), true);
  check("la línea manual es BONO", manual.codigo, "BONO");
  check("la línea manual está editada", manual.editada, true);
  const sueldoGuardado = lineaPorCodigo(lineasGuardadas, "SUELDO_BASE", "CALCULADA");
  check("el sueldo quedó editado", sueldoGuardado.monto, "500.00");
  check("el sueldo quedó marcado", sueldoGuardado.editada, true);

  // La ley se recalculó con la tasa congelada y la base nueva (570.00).
  const sso = lineaPorCodigo(lineasGuardadas, "SSO", "LEY");
  check("base de ley recalculada", sso.baseCalculo, "570.00");
  check("tasa congelada", sso.tasaAplicada, "0.0400");
  check("SSO recalculado", sso.monto, "22.80");
  const faov = lineaPorCodigo(lineasGuardadas, "FAOV", "LEY");
  check("FAOV recalculado", faov.monto, "5.70");

  const versionVieja = await ejecutar(
    admin,
    "Payroll",
    "PreNomina",
    "guardar",
    [preNominaId, 1, { recibos: [{ reciboId: recibo.id, lineas: [] }] }],
  );
  check("guardar con version vieja responde 409", versionVieja.status, 409);
  check(
    "mensaje de version vieja",
    versionVieja.body.error,
    "La pre-nómina cambió desde que la abriste; vuelve a cargarla.",
  );

  const bloqueada = await ejecutar(
    admin,
    "Payroll",
    "PreNomina",
    "guardar",
    [preNominaId, 2, {
      recibos: [
        { reciboId: recibo.id, lineas: [{ id: novedadLinea.id, monto: "1.00" }] },
      ],
    }],
  );
  check("editar una novedad responde 400", bloqueada.status, 400);
  check(
    "mensaje de línea bloqueada",
    bloqueada.body.error,
    "La línea no es editable; su valor lo manda su origen.",
  );

  const vacio = await ejecutar(admin, "Payroll", "PreNomina", "guardar", [
    preNominaId,
    2,
    { recibos: [] },
  ]);
  check("recibos vacío responde 400", vacio.status, 400);
  check(
    "mensaje de recibos vacío",
    vacio.body.error,
    "No se enviaron recibos para guardar.",
  );

  // --- confirmar ------------------------------------------------------------
  const confirmarVieja = await ejecutar(
    admin,
    "Payroll",
    "PreNomina",
    "confirmar",
    [preNominaId, 1],
  );
  check("confirmar con version vieja responde 409", confirmarVieja.status, 409);

  const confirmado = await ejecutar(
    admin,
    "Payroll",
    "PreNomina",
    "confirmar",
    [preNominaId, 2],
  );
  check("confirmar pre-nómina", confirmado.status, 200);
  check("período PROCESADO", confirmado.body.periodo.estado, "PROCESADO");
  check("un recibo final", confirmado.body.recibos.length, 1);
  check("novedad aplicada", confirmado.body.novedadesAplicadas, 1);
  check("cuota descontada", confirmado.body.cuotasDescontadas, 1);
  check("préstamo pagado", confirmado.body.prestamosPagados, 1);
  check("borrador eliminado", confirmado.body.preNominaEliminada, true);

  const { rows: borradoresRestantes } = await db.query(
    "SELECT count(*)::int AS n FROM pre_nomina WHERE id = $1",
    [preNominaId],
  );
  check("no queda borrador", borradoresRestantes[0].n, 0);

  const { rows: recibosFinales } = await db.query(
    `SELECT id, monto_total, total_asignaciones, total_deducciones, estado
       FROM recibo_pago
      WHERE periodo_nomina_id = $1 AND persona_id = $2`,
    [periodoId, personaId],
  );
  check("un recibo_pago", recibosFinales.length, 1);
  const reciboFinal = recibosFinales[0];
  check("neto final", reciboFinal.monto_total, "408.65");
  check("asignaciones finales", reciboFinal.total_asignaciones, "570.00");
  check("deducciones finales", reciboFinal.total_deducciones, "161.35");

  const { rows: detallesFinales } = await db.query(
    `SELECT d.concepto_id, co.codigo, d.cuota_prestamo_id, d.novedad_id,
            d.concepto_persona_id, d.parametro_aporte_id, d.base_calculo,
            d.tasa_aplicada, d.cantidad_unidades, d.monto
       FROM detalle_recibo d
       JOIN concepto co ON co.id = d.concepto_id
      WHERE d.recibo_pago_id = $1
      ORDER BY co.codigo`,
    [reciboFinal.id],
  );
  check("líneas del recibo final", detallesFinales.length, 11);
  const finalSueldo = detallesFinales.find((fila) => fila.codigo === "SUELDO_BASE");
  check("sueldo final", finalSueldo.monto, "500.00");
  check("sueldo final sin origen", finalSueldo.novedad_id, null);
  const finalBono = detallesFinales.find((fila) => fila.codigo === "BONO");
  check("bono manual final", finalBono.monto, "25.00");
  const finalNovedad = detallesFinales.find(
    (fila) => fila.codigo === "HORA_EXTRA" && fila.novedad_id != null,
  );
  check("novedad final con FK", Boolean(finalNovedad), true);
  check("monto de la novedad", finalNovedad.monto, "45.00");
  const finalRecurrente = detallesFinales.find(
    (fila) => fila.concepto_persona_id != null,
  );
  check("recurrente final con FK", Boolean(finalRecurrente), true);
  check("monto del recurrente", finalRecurrente.monto, "20.00");
  const finalPrestamo = detallesFinales.find(
    (fila) => fila.cuota_prestamo_id != null,
  );
  check("préstamo final con FK", Boolean(finalPrestamo), true);
  check("cuota final", finalPrestamo.monto, "110.00");
  const finalSso = detallesFinales.find((fila) => fila.codigo === "SSO");
  check("parámetro de ley final", finalSso.parametro_aporte_id != null, true);
  check("base de ley final", finalSso.base_calculo, "570.00");
  check("tasa de ley final", finalSso.tasa_aplicada, "0.0400");
  check("monto SSO final", finalSso.monto, "22.80");

  const { rows: novedadFinal } = await db.query(
    "SELECT estado FROM novedad WHERE id = $1",
    [novedadId],
  );
  check("novedad APLICADA", novedadFinal[0].estado, "APLICADA");
  const { rows: cuotaFinal } = await db.query(
    "SELECT estado FROM cuota_prestamo WHERE prestamo_id = $1 AND nro_cuota = 1",
    [prestamo.body.prestamo.id],
  );
  check("cuota DESCONTADA", cuotaFinal[0].estado, "DESCONTADA");
  const { rows: prestamoFinal } = await db.query(
    "SELECT estado FROM prestamo WHERE id = $1",
    [prestamo.body.prestamo.id],
  );
  check("préstamo PAGADO", prestamoFinal[0].estado, "PAGADO");
  const { rows: periodoFinal } = await db.query(
    "SELECT estado FROM periodo_nomina WHERE id = $1",
    [periodoId],
  );
  check("período PROCESADO en la BD", periodoFinal[0].estado, "PROCESADO");

  const listaSinBorrador = await ejecutar(
    admin,
    "Payroll",
    "Period",
    "listar",
  );
  const filaSinBorrador = listaSinBorrador.body.find(
    (fila) => fila.id === periodoId,
  );
  check("listar ya no muestra borrador", filaSinBorrador.preNominaId, null);

  const procesarDeNuevo = await ejecutar(admin, "Payroll", "Period", "procesar", [
    periodoId,
  ]);
  check("procesar un período PROCESADO responde 409", procesarDeNuevo.status, 409);
  check(
    "mensaje de período procesado",
    procesarDeNuevo.body.error,
    "Solo se puede procesar un período en BORRADOR.",
  );

  // --- pagar y el empleado ve su recibo ------------------------------------
  const pagado = await ejecutar(admin, "Payroll", "Period", "pagar", [
    periodoId,
    FECHA_PAGO,
    "TRANSFERENCIA",
    "E2E-PRE-REF",
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

  const cambio = await ejecutar(empleado, "Security", "User", "cambiarClave", [
    CLAVE,
    CLAVE,
  ]);
  check("cambiar clave del empleado", cambio.status, 200);

  const misRecibos = await ejecutar(empleado, "Payroll", "Receipt", "misRecibos");
  check("misRecibos", misRecibos.status, 200);
  check("un recibo propio", misRecibos.body.length, 1);
  check("neto del recibo propio", misRecibos.body[0].monto_total, "408.65");

  const miDesglose = await ejecutar(empleado, "Payroll", "Receipt", "miDesglose", [
    reciboFinal.id,
  ]);
  check("miDesglose", miDesglose.status, 200);
  check("detalle propio", miDesglose.body.detalle.length, 11);

  // --- permisos -------------------------------------------------------------
  const empleadoGenera = await ejecutar(
    empleado,
    "Payroll",
    "PreNomina",
    "generar",
    [periodoId],
  );
  check("empleado no genera pre-nómina", empleadoGenera.status, 403);
  check(
    "mensaje de permiso",
    empleadoGenera.body.error,
    "No autorizado para ejecutar el método.",
  );

  const empleadoVer = await ejecutar(empleado, "Payroll", "PreNomina", "ver", [
    preNominaId,
  ]);
  check("empleado no ve la pre-nómina", empleadoVer.status, 403);

  const altaAdmin = await ejecutar(admin, "Security", "User", "registrar", [
    {
      cedula: CEDULA_ADMIN,
      primer_nombre: "E2E",
      primer_apellido: "PreAdmin",
      email: EMAIL_ADMIN,
      username: USERNAME_ADMIN,
      password: CLAVE,
      perfiles: [perfilAdmin.id],
    },
  ]);
  check("registrar administrador temporal", altaAdmin.status, 200);

  const tempAdmin = crearCliente(base);
  const loginTempAdmin = await tempAdmin.pedir("/api/login", {
    method: "POST",
    body: { username: USERNAME_ADMIN, password: CLAVE },
  });
  check("login administrador temporal", loginTempAdmin.status, 200);

  const cambioAdmin = await ejecutar(
    tempAdmin,
    "Security",
    "User",
    "cambiarClave",
    [CLAVE, CLAVE],
  );
  check("cambiar clave del administrador", cambioAdmin.status, 200);

  const opcionesTempAdmin = await ejecutar(
    tempAdmin,
    "Security",
    "Menu",
    "getOptions",
    [perfilAdmin.id],
  );
  check("getOptions del administrador", opcionesTempAdmin.status, 200);
  check(
    "el administrador NO ve PreNomina",
    opcionesTempAdmin.body.some((opcion) => opcion.nombre === "PreNomina"),
    false,
  );

  const adminGenera = await ejecutar(
    tempAdmin,
    "Payroll",
    "PreNomina",
    "generar",
    [periodoId],
  );
  check("administrador no genera pre-nómina", adminGenera.status, 403);
  check(
    "mensaje de permiso del administrador",
    adminGenera.body.error,
    "No autorizado para ejecutar el método.",
  );
} finally {
  await limpiar();
  check(
    "sin residuos de usuario",
    (
      await db.query("SELECT count(*)::int AS n FROM usuario WHERE username = ANY($1::text[])", [
        [USERNAME, USERNAME_ADMIN],
      ])
    ).rows[0].n,
    0,
  );
  check(
    "sin residuos de período",
    (
      await db.query(
        "SELECT count(*)::int AS n FROM periodo_nomina WHERE frecuencia = $1 AND fecha_inicio = $2 AND fecha_fin = $3",
        [PERIODO.frecuencia, PERIODO.inicio, PERIODO.fin],
      )
    ).rows[0].n,
    0,
  );
  check(
    "sin residuos de pre-nómina",
    preNominaId
      ? (
          await db.query("SELECT count(*)::int AS n FROM pre_nomina WHERE id = $1", [
            preNominaId,
          ])
        ).rows[0].n
      : 0,
    0,
  );
  await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
}

console.table(casos);
console.log("PRE NOMINA E2E OK");
process.exit(0);
