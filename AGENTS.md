# AGENTS.md — Sistema de Nómina

Instrucciones para cualquier agente (OpenCode u otro) que trabaje en este
repo. Leer completo antes de tocar código. Los principios que no se negocian
están en `docs/constitution.md`.

Sistema de nómina: **proyecto final de Desarrollo Web 2**. Aplicación
**monolítica**, entregada desplegada y **defendida por partes**: Front,
Sesión, Seguridad, Objetos de negocio, Señalización, Logs y Validación.

- Formas de pago: por hora trabajada (`POR_HORA`) o salario fijo
  (`SALARIO_FIJO`).
- Frecuencias: semanal, quincenal, mensual.
- Incluye: descuentos de ley (seguro social y otros), descuentos opcionales,
  bonos (puntuales y recurrentes) y préstamos con cuotas.
- Contexto legal asumido: **Venezuela** (cédula, RIF, IVSS, paro forzoso,
  vivienda). Las tasas y topes viven en la BD, no en el código.
- **Una sola moneda** (decisión consciente: se quitaron `Moneda` y
  `Tasa_cambio`).

**Idioma:** código, tablas, mensajes de error y comentarios en **español**.
JS: `camelCase` para variables y métodos, `PascalCase` para clases.
Identificadores de librerías (imports, APIs) en inglés, porque son externos.

## Estado actual — leer antes de nada

La **Sesión ya está hecha**: el backend arranca, conecta a PostgreSQL (Neon)
y autentica.

- `src/index.js` levanta Express en `PORT` (3000 por defecto) y cierra el
  pool ante `SIGINT`/`SIGTERM`.
- `src/app.js` monta `express.json`, `cors` con credenciales y
  `express-session` (cookie `httpOnly`).
- `POST /api/login` valida credenciales y guarda `userID`, `userName` y
  `profiles` en la sesión; `GET /api/me` (protegido) devuelve la sesión;
  `POST /api/logout` la destruye.
- `POST /execute` (protegido) recibe `{subsystem, class, method, params}`,
  delega en `Security.executeMethod` y responde con su `status`/`body`.
- Acceso a datos: `src/config/database.js` (un `Pool` de `pg`) y el
  componente `src/database/Database.js` (`db.query` / `db.transaction`). Las consultas
  hoy viven en
  `src/queries/queries.yaml` (formato YAML) y las carga
  `src/queries/loader.js`.
- `db/init.sql` es el **esquema base** (un solo archivo, v8, 27 tablas, en
  snake_case minúscula, **sin número**): se corre UNA vez sobre una base
  vacía. Los cambios posteriores van en `db/migrations/NNN_nombre.sql`.
  `db/seed-seguridad.sql` siembra subsistemas/clases/métodos/perfiles
  (`Publico`, `Empleado`, `GerenteRRHH`, `Administrador`, `Superusuario`) y
  sus permisos; `db/seed-usuario-prueba.sql` crea el usuario de prueba
  (`admin_prueba`/`Password123`) ligado a los cuatro perfiles.
  `db/seed-datos-prueba.sql` (solo desarrollo, idempotente) siembra 14 personas
  con contrato, cuentas, afiliaciones, recurrentes, horas hasta dic-2026,
  novedades, préstamos y 20 períodos, más cinco usuarios con clave
  `Password123` (`luis_gomez`, `pedro_hernandez`, `carmen_diaz` como
  `Empleado`; `rosa_vargas` como `Empleado` + `RRHH`; y `admin_prueba`, que
  además de los cuatro perfiles tiene contrato quincenal de empleado y ve sus
  propios recibos). `scripts/manual/demo_periodos.mjs --yes` procesa y paga
  algunos de esos períodos con los BO reales y deja una pre-nómina en borrador
  en `Semana 4 de noviembre 2026` para probar la pantalla.

**Hecho:** el esquema del profesor está consolidado en `db/init.sql`
(UUID en tablas transaccionales y `persona`/`usuario`/`refresh_token`;
`serial` en las maestras; tabla `refresh_token` para JWT con rotación),
probado end-to-end en un Postgres local (27 tablas, 18 enums, login real
con UUID). Las consultas viven en `queries.yaml`; el seed de seguridad está
aplicado (`db/seed-seguridad.sql`); `src/security/Security.js` (mapas y
`executeMethod`) y los BO de `src/bo/Session/` (`Session.js`) y `src/bo/Security/` (`Menu.js`, `Admin.js`, `User.js`) existen; el login usa
`bcrypt` con bloqueo por intentos y la sesión guarda los perfiles N:M.
`db/schema.dbml` (v12, 33 tablas) está escrito, en snake_case minúscula, y
espeja `db/init.sql` **más las migraciones aplicadas** (mismas tablas y
columnas; `init.sql` sigue en v8 con 27 tablas).
La sesión se separó a su propio subsistema.
**Las specs 002 (seguridad, T1–T14) y 003 (`POST /execute`) están
implementadas y verificadas.**
**La spec 004 (JWT) está en implementación**: access token en cookie
`httpOnly` (`access_token`) firmado con `jose` (HS256), refresh rotativo por
familia (`refresh_token`) en ruta propia `POST /api/refresh`, guard del access
token en `Security.executeMethod` y revocación de familia en `logout`.
`src/services/TokenService.js` y `src/bo/Session/Token.js` existen; la clase
`Token`/método `refresh` está sembrada en `db/seed-seguridad.sql` (perfil
`Publico`).
**Subsistema `Payroll` (nómina) implementado (2026-11-08):** 8 BO en
`src/bo/Payroll/` (`Cargo`, `Hours`, `Affiliation`, `Concept`, `Novedad`,
`Loan`, `Period`, `Receipt`) con consultas propias en
`src/bo/Payroll/queries.yaml`; `src/services/PayrollCalculator.js`
(`decimal.js`, 240 h/mes, extra ×1.5, prorrateo por frecuencia, cuotas con
interés simple plano). La migración `db/migrations/004_payroll.sql` agrega
`registro_horas`, `cargo.valor_hora_base`, conceptos, aportes de ley,
clases/métodos/permisos y menú; la `005_listar_personas.sql` agrega
`Security/User/listarPersonas` (RRHH necesita el `persona_id`). Pruebas del
calculador en `test/payrollCalculator.test.js` (69/69) y verificación E2E en
`scripts/manual/payroll_e2e.mjs`. **Actualización 2026-11-08: 004 y 005 ya
están aplicadas en el branch de desarrollo de Neon** (la credencial volvió a
autenticar); `pnpm test` 69/69 y `payroll_e2e.mjs` 50/50 → `PAYROLL E2E OK`.
Los pasos originales para el socio quedan en `PENDIENTE-SOCIO.txt`.

**Spec 009 (permisos de método por perfil) implementada (2026-11-08):**
`Security/Admin` suma `listarMetodos`, `listarPermisosMetodo`,
`asignarPermisoMetodo` y `quitarPermisoMetodo`, exclusivos de
`Superusuario`; la migración `db/migrations/006_permisos_metodos.sql` los
siembra y crea la opción de menú `Permisos`, también exclusiva de ese perfil.
Cada cambio se escribe primero en `permiso_metodo` y después actualiza
`PermissionMethodMap` con `security.setPermissionMethod` (sin reiniciar).
`Superusuario` no puede perder los cinco métodos que sostienen la vista
(409). `pnpm test` 80/80 y `scripts/manual/permisos_e2e.mjs` 38/38 →
`PERMISOS E2E OK`.

**Opciones de menú de Security completadas (2026-11-08):** la migración
`db/migrations/007_opciones_security.sql` concede `registrar`, `Usuarios` y
`Perfiles` a los perfiles que pueden ejecutar sus métodos (el seed no había
llegado completo a la base viva): `registrar` → Superusuario/RRHH;
`Usuarios` → Superusuario/Administrador/RRHH; `Perfiles` →
Superusuario/Administrador. `Permisos` sigue solo de Superusuario.

**Spec 010 (administración de perfiles) implementada (2026-11-08):**
`Security/Admin` suma `listarPerfilesAdmin` (Superusuario y Administrador),
`crearPerfil`, `editarPerfil` y `cambiarEstadoPerfil` (solo Superusuario);
`Security/User` suma `establecerPerfilesUsuario` (solo Superusuario), que
reemplaza el conjunto completo de perfiles de un usuario en una transacción, y
`listarPerfilesUsuario` (Superusuario y Administrador), que devuelve el
conjunto actual con activos e inactivos. La migración
`db/migrations/008_perfiles.sql` siembra los cinco métodos y sus
permisos y corrige la descripción de la opción `Perfiles`; no hay cambio de
esquema. La `009_listar_perfiles_usuario.sql` agrega el método de lectura. Un
perfil nuevo nace con 6 permisos base de sesión
(`Session/Session/{logout,getSession,sessionExist}`, `Session/Token/refresh`,
`Security/Menu/getOptions`, `Security/User/cambiarClave`). Dos guardas:
escalada de privilegios (`403` si un no Superusuario intenta asignar
`Superusuario`, `Administrador` o `GerenteRRHH`, en `registrar` y en
`establecerPerfilesUsuario`) y anti-bloqueo (`409` si `Superusuario` se
renombra/desactiva o si se quita al último superusuario activo). `pnpm test`
102/102 y `scripts/manual/perfiles_e2e.mjs` 43/43 → `PERFILES E2E OK`.

**Spec 011 (administración de opciones de menú) implementada (2026-11-09):**
`Security/Admin` suma el catálogo `listarSubsistemas`, `listarOpciones`,
`crearOpcion`, `editarOpcion` y `cambiarEstadoOpcion`, y la asignación
perfil ↔ opción `listarPermisosOpcion`, `asignarPermisoOpcion` y
`quitarPermisoOpcion`, todos solo para `Superusuario`. La migración
`db/migrations/010_opciones_perfil.sql` siembra los siete métodos del
catálogo y la asignación, sus permisos y la opción de menú `Opciones`
(Security, orden 5); la `011_listar_subsistemas.sql` agrega
`listarSubsistemas`, que es el origen de los `subsistemaId` de `crearOpcion`.
No hay cambio de esquema.
`crearPerfil` acepta un tercer parámetro opcional `perfilPlantillaId` y clona
en la misma transacción los `permiso_metodo` **y** los `permiso_opcion` de la
plantilla, para que el perfil nuevo no vea entradas que no puede ejecutar.
`listarOpciones` devuelve activas e inactivas con `subsistemaId`, `perfiles`
(solo perfiles activos) y `protegida`. Guardas: `OPCIONES_CRITICAS =
{Security/Opciones, Security/Permisos, Security/Perfiles, Security/Usuarios}`
no se pueden quitar, renombrar ni desactivar en `Superusuario` (`409`), y
`METODOS_CRITICOS` incluye los ocho métodos nuevos. `pnpm test` 133/133 y
`scripts/manual/opciones_e2e.mjs` 62/62 → `OPCIONES E2E OK`.

**Horas extras (2026-11-10):** `Payroll/Hours` suma `registrarExtra`,
`listarExtrasPorPeriodo` y `quitarExtra`. No hay
cambio de esquema: la extra se guarda en `registro_horas.horas_extra` y el
`UNIQUE (persona_id, fecha)` obliga a un **upsert** que suma sobre la fila del
día (si RRHH ya registró horas normales, se conservan). `quitarExtra` pone
`horas_extra = 0` y solo borra la fila si `horas_normales = 0`. La migración
`db/migrations/012_horas_extras.sql` (solo datos, idempotente) siembra los tres
métodos, sus permisos y la opción de menú `HorasExtras` (Payroll, orden 9) para
`Superusuario`; la `013_horas_extras_rrhh.sql` extiende métodos y opción a
`RRHH`/`GerenteRRHH`. La pantalla `Horas` se mantiene igual
para RRHH y Superusuario. Front: `OvertimePage` en `/payroll/horas-extras`,
con guard por nombre de perfil porque `Administrador` comparte el rol
`superuser`. `pnpm test` 149/149 y `scripts/manual/horas_extras_e2e.mjs` 45/45
→ `HORAS EXTRAS E2E OK`.

**Spec 012 (pre-nómina) implementada (2026-11-15):** `Payroll/PreNomina` con
`generar`, `ver`, `guardar`, `eliminar` y `confirmar`, más tres tablas
(`pre_nomina`, `pre_nomina_recibo`, `pre_nomina_detalle`) y el enum
`origen_linea` (`CALCULADA`, `RECURRENTE`, `NOVEDAD`, `PRESTAMO`, `LEY`,
`MANUAL`) en `db/migrations/014_pre_nomina.sql`; `db/schema.dbml` queda en v10
(31 tablas). Un borrador por período (`UNIQUE (periodo_nomina_id)`), sin
columna de estado: existe o no existe. `guardar` reemplaza las líneas
editables del recibo enviado y recalcula `LEY`/`APORTE_PATRONAL` con la tasa
congelada; `confirmar` escribe el recibo final con `PayrollWriter` y borra el
borrador en la misma transacción. `src/bo/Payroll/PayrollWriter.js` concentra
el cálculo y la escritura que antes vivía dentro de `Period.procesar`, que
ahora responde `409` si hay borrador sin confirmar; `Period.listar`/`ver`
exponen `preNominaId`/`preNominaVersion` (`ver` además `preNomina`). Permisos
solo `RRHH` y `Superusuario`, más la opción de menú `PreNomina` (Payroll,
orden 10). `pnpm test` 202/202 (40 en `test/preNomina.test.js`) y
`scripts/manual/pre_nomina_e2e.mjs` 143/143 → `PRE NOMINA E2E OK`. Diagrama
`archify` refrescado (nodo `PayrollWriter`, `pre_nomina*` en Neon y vista
"Pre-nómina").

**Auditoría de seguridad implementada (2026-11-16):** sesión persistida en
PostgreSQL (`db/migrations/015_sesion.sql` + `src/database/SessionStore.js`,
tabla `sesion`, 32 tablas en `db/schema.dbml` v11); `src/config/http.js` es la
única fuente de orígenes para CORS y para `verificarOrigen` (403 en métodos
que cambian estado); `src/middlewares/rateLimit.js` limita por IP los fallos de
login (429 + `Retry-After`); `helmet` con CSP explícita, `no-referrer`, HSTS en
producción y `no-store` global; 404/400/413 en JSON; `Security/User/registrar`
valida largos, formatos, fechas, enums y monto antes de la transacción;
`cambiarClave` rechaza reutilizar la clave y revoca todos los refresh tokens.
`pnpm audit --prod` sin vulnerabilidades (overrides `body-parser 2.4.0` y
`qs 6.17.1` en `pnpm-workspace.yaml`). `pnpm test` 228/228. El detalle, los
riesgos residuales y la verificación están en `docs/auditoria-seguridad.md`.

**Spec 013 (resumen de nómina) implementada (2026-11-19):** `Payroll/Period`
suma `resumen(periodoId)`, que devuelve personas, asignaciones, deducciones,
neto, aporte patronal y costo total, más el desglose por concepto, y
`listarConTotales()`, el histórico de períodos con sus totales. Los recibos
`ANULADO` no suman; el aporte patronal sale de `detalle_recibo` (no es columna
de `recibo_pago`) y se reporta aparte del neto. Migración
`016_resumen_nomina.sql` (solo datos) con permisos para `RRHH`, `GerenteRRHH`,
`Administrador` y `Superusuario`. `pnpm test` 250/250 y
`scripts/manual/resumen_e2e.mjs` 17/17 → `RESUMEN E2E OK`. Sin cambio de
esquema ni de topología.

**Spec 014 (PDF del recibo) implementada (2026-11-19):** `Payroll/Receipt`
suma `generarPdf(reciboId)`, que arma el PDF en el servidor con `pdfkit`
(`src/services/ReciboPdfService.js`) y devuelve
`{ nombreArchivo, mimeType, tamanioBytes, contenidoBase64 }` por `/execute`.
Los gestores (`RRHH`, `GerenteRRHH`, `Administrador`, `Superusuario`)
descargan cualquier recibo; `Empleado` solo el suyo, y esa pertenencia se
valida en el BO (`403`), no en el mapa de permisos. Migración
`017_pdf_recibo.sql` siembra el método para los cinco perfiles. `pnpm test`
256/256 y `scripts/manual/pdf_recibo_e2e.mjs` 20/20 → `PDF RECIBO E2E OK`.
Sin cambio de esquema.

**Spec 015 (registro de personas y despidos) implementada (2026-11-19):**
nuevo BO `Payroll/Employee` con `listar`, `ver`, `despedir`, `listarDespidos`
y `listarMotivos`; tabla `despido` y enum `motivo_despido` en la migración
`018_despidos.sql`; opciones de menú `Personas` (11) y `Despidos` (12) solo
para `RRHH` y `Superusuario`. `despedir` corre en una transacción: inserta el
despido, finaliza el contrato, inactiva la persona, desactiva el usuario,
revoca sus refresh tokens y borra sus sesiones. `findContratosVigentesPorFrecuencia`
ahora incluye contratos `FINALIZADO` con `fecha_fin` dentro del período, y
`PayrollCalculator.sueldoPeriodoProporcional` prorratea el sueldo fijo por
días trabajados. `db/schema.dbml` v12 (33 tablas). `pnpm test` 271/271 y
`scripts/manual/despidos_e2e.mjs` 45/45 → `DESPIDOS E2E OK`.

**Opción de menú Reportes (2026-11-20):** la migración de datos
`019_reportes_opcion.sql` crea `Payroll/Reportes` (orden 13) para `RRHH` y
`Superusuario`. El front del repo `proyecto-de-nomina-` la expone en
`/payroll/reportes` con el resumen final de todos los períodos emitidos, el
desglose por concepto, el resumen por empleado y el PDF de cada recibo, sin
métodos ni permisos nuevos (reutiliza `Period.listarConTotales`,
`Period.resumen`, `Receipt.listarPorPeriodo` y `Receipt.generarPdf`). El E2E
del front `pnpm e2e:reportes` pasa 12/12.

**Más períodos y `admin_prueba` como empleado (2026-11-20):** el seed suma 7
períodos (4 semanales, 2 quincenales y `Diciembre 2026`) y extiende las horas
de los contratos `POR_HORA` hasta diciembre. `admin_prueba` recibe contrato
`QUINCENAL`/`SALARIO_FIJO` (15000,00 mensuales), cuenta principal, cuatro
afiliaciones, un bono recurrente y una novedad aprobada; el demo procesa las
dos quincenas nuevas y deja 2 recibos suyos. Sin esquema, BO ni permisos
nuevos. `scripts/manual/mas_nominas_e2e.mjs --yes` verifica 22/22 (datos en
BD, `misRecibos`, PDF y menú `Empleado`), `pnpm test` 271/271. Seed y demo son
repetibles.

**Pendiente:** el endpoint del menú y el front (Fase 5), la pantalla
`/payroll/pre-nomina` y los contratos de resumen, PDF y despidos (el documento
`PROMPT-FRONT-NOMINA.md` del repo del front), y migrar las consultas de
`queries.yaml` a los BO.

El detalle histórico por fase vive en `docs/bitacora.md`.

## Stack

```
Backend
  Node.js + Express            capa HTTP
  express-session              sesión por cookie (httpOnly, sameSite lax)
  pg                           PostgreSQL en Neon; SQL parametrizado
  bcrypt                       hash de contraseñas (login y registro)
  decimal.js                   aritmética exacta de dinero (pendiente)

Frontend (otro repositorio)
  JavaScript nativo            react
  Web Components + Shadow DOM  componentes `ui-*`
  Signals                      reactividad propia (Proxy + Observer)
  fetch                        una sola función `execute(...)` contra /execute

Base de datos
  PostgreSQL en Neon           db/init.sql (sin número) + db/migrations/ + espejo db/schema.dbml
```

**Nunca se usa `float` para dinero.** Los `DECIMAL` llegan como **texto** desde
`node-pg` y se operan con `decimal.js` (o enteros en céntimos). Ver skill
`nomina-dominio`.

## Arquitectura: monolito con un solo punto de entrada

Todo el negocio pasa por un único endpoint. El cliente no arma rutas por
entidad: manda un sobre con `subsystem`, `class`, `method` y `params`.

```
Cliente ──fetch POST /execute──▶ { subsystem, class, method, params }
   └▶ Security.executeMethod
        1. valida la forma de la solicitud           → 400
        2. busca el permiso en PermissionMethodMap    → 403
        3. reflexión: ubica src/bo/<Subsistema>/<Clase>.js (descubrimiento
           dinámico de disco) → 501
        4. ejecuta el objeto de negocio (BO)
             └▶ src/database/Database.js ──▶ PostgreSQL (Neon)
```

El orden **no se invierte**. Validar el permiso después de la reflexión deja
que el cliente elija qué archivo se carga antes de estar autorizado. Ocultar
un menú nunca sustituye validar en el servidor. Ver skill `nomina-seguridad`.

- **Solo los objetos de negocio tocan la base de datos.** Las rutas no llevan
  SQL. Los BO consultan únicamente a través del componente de BD, con
  parámetros (`$1`, `$2`), nunca concatenando texto.
- La reflexión se defiende con tres cosas: los nombres se validan con regex
  antes de armar el `import()` dinámico (el proyecto es ESM), el método se
  busca con `Object.prototype.hasOwnProperty.call(...)` (evita `constructor`,
  `__proto__`) y la clase se cachea por `Subsistema/Clase`.

## Esquema de seguridad

El esquema no se inventa: sigue el dibujo de clase. Está prohibido
reintroducir `Rol`, `Permiso`, `Perfil_Permiso` o `Perfil_Metodo`.

```
Persona 1─1 Usuario ─N:M─ Perfil        (tabla puente: Usuario_Perfil)
Subsistema 1─N Opcion                    lo que el usuario VE
Subsistema 1─N Clase 1─N Metodo          lo que el servidor EJECUTA
Perfil N:M Opcion   → Permiso_Opcion
Perfil N:M Metodo   → Permiso_Metodo
```

- **`Opcion` ≠ `Metodo`.** Opción = lo que se ve (menú, pantalla). Método =
  lo que el servidor ejecuta. Proteger solo el menú deja los endpoints
  abiertos.
- El **permiso es la fila** de `Permiso_Opcion` / `Permiso_Metodo`, no una
  tabla `Permiso`.
- Un usuario puede tener **varios perfiles**; basta con que uno autorice
  (lógica OR).
- **Mapas en memoria** (`PermissionMethodMap`, `PermissionOptionMap`)
  cargados al arrancar con `loadPermission()`: acceso O(1) sin consultar la
  BD en cada petición.
- **Llave del mapa:** `Subsistema_Clase_metodo_perfilId`. Por eso los nombres
  no llevan `_` (dos combinaciones distintas no pueden dar la misma llave).
  *Pendiente de confirmar con el profesor: nombres vs ids.*

## Estructura de carpetas

Objetivo (lo que aún no existe se anota):

```
AGENTS.md                    este archivo
MEMORY.md                    snapshot corto entre sesiones
docs/constitution.md         principios innegociables
docs/bitacora.md             historial fase por fase
.opencode/commands/          comandos /sdd-*
.opencode/skills/            skills del proyecto
specs/<NNN-feature>/         spec.md, plan.md, tasks.md

src/index.js                 arranque del servidor
src/app.js                   Express + cors + express-session
src/config/database.js       Pool de pg (ver "Entornos")
src/database/Database.js     componente único de BD (db.query / db.transaction)
src/queries/queries.yaml     consultas actuales en YAML (deben migrarse a los BO)
src/queries/loader.js        carga el YAML una sola vez al arrancar
src/routes/routes.js         router montado en /api (POST /execute)
src/security/Security.js     objeto de seguridad, mapas, reflexión
src/bo/<Subsistema>/<Clase>.js  objetos de negocio (nombres en inglés; la clase igual al archivo)
src/services/<Clase>.js      lógica reutilizable sin BD ni sesión (PasswordService, PermissionKeyService, TokenService)
src/errors/                  ErrorNegocio y utilidades de log
db/init.sql                  esquema base, se corre una vez (v8, 27 tablas, sin número)
db/migrations/NNN_nombre.sql cambios posteriores sobre base con datos (número primero)
db/schema.dbml               modelo completo para dbdiagram.io (init.sql + migraciones)
public/                      front: componentes, signals, estilos (otro repo)
```

No se crea una carpeta hasta que haya código real que la llene.

## Convenciones

- **Idioma:** español (código, tablas, mensajes). Imports y APIs en inglés.
- **Tablas y columnas:** `Pascal_con_guion_bajo` **sin comillas** en el DDL.
  PostgreSQL las guarda en minúsculas: en JS se leen en minúsculas
  (`row.password_hash`, `row.perfil_id`).
- `Subsistema.Nombre`, `Clase.Nombre` y `Metodo.Nombre`: alfanuméricos, sin
  espacios ni `_`, **idénticos** al nombre real en el código (mayúsculas
  incluidas). Es lo que permite armar la llave del mapa con `_`.
- JS: `camelCase` para variables y métodos, `PascalCase` para clases.
- Componentes web con prefijo `ui-` (`ui-stepper`, `ui-tabs`).
- Lo que lleva comentario es el **porqué**, no el qué.

## Buenas prácticas

Estas reglas no se negocian: no se busca la salida rápida que "funciona", sino
lo que se usa en la industria. Si un atajo contradice una práctica establecida,
gana la práctica.

- **Analizar antes de escribir.** Entender el problema y elegir la solución
  correcta, no el parche mínimo. Dejar constancia del porqué cuando la decisión
  no sea obvia.
- **Sintaxis moderna.** Funciones **flecha** (no `function`), `const`/`let`
  (nunca `var`), `async`/`await` (no callbacks ni cadenas de `.then`),
  desestructuración, optional chaining (`?.`) y template literals.
- **Todo se maneja por clases.** La lógica vive en clases (`PascalCase`):
  objetos de negocio, componente de BD y servicios son clases. Dentro de la
  clase, los métodos son funciones flecha; **excepción:** los métodos que la
  seguridad ejecuta por reflexión van en el **prototipo** (métodos normales),
  porque la autorización los busca con `hasOwnProperty` sobre
  `Clase.prototype`. Los handlers de Express son flechas que **delegan** en la
  clase; no contienen la lógica.
- **Una responsabilidad por clase/archivo.** Sin estado global mutable, salvo
  el pool de conexiones.
- **Validar en los bordes:** la entrada del usuario se valida antes de tocar
  negocio o base de datos.
- **Errores explícitos:** no tragar excepciones en silencio; registrar el
  porqué y propagar con un mensaje útil.
- **No repetir lógica:** si algo se usa en dos lugares, se extrae.

## Base de datos

El modelo objetivo es la **v8 (27 tablas)**, consolidado en `db/init.sql`
(un solo archivo en snake_case minúscula). Las migraciones agregan tablas
(`registro_horas` en la 004; `pre_nomina`, `pre_nomina_recibo` y
`pre_nomina_detalle` en la 014; `despido` en la 018) y `db/schema.dbml`
refleja el estado final (v12, 33 tablas).
Las tablas transaccionales y `persona`/`usuario`/`refresh_token` usan `uuid`;
las maestras (`perfil`, `subsistema`, `opcion`, `clase`, `metodo`, `concepto`,
`banco`, `cargo`, `tipo_aporte_ley`, `parametro_aporte_ley`) usan `serial`.

| Grupo | Tablas |
|---|---|
| Seguridad: identidad | usuario, perfil, usuario_perfil, refresh_token |
| Seguridad: estructura | subsistema, opcion, clase, metodo |
| Seguridad: permisos | permiso_opcion, permiso_metodo |
| Personal | persona, cuenta_bancaria, banco, cargo, contrato, contrato_salario, despido |
| Ley y seguro social | tipo_aporte_ley, parametro_aporte_ley, afiliacion_ley |
| Nómina | concepto, concepto_persona, novedad, registro_horas, periodo_nomina, recibo_pago, detalle_recibo |
| Pre-nómina | pre_nomina, pre_nomina_recibo, pre_nomina_detalle |
| Préstamos | prestamo, cuota_prestamo |

Relaciones clave:

- `persona 1─1 usuario`; `usuario N─M perfil` vía `usuario_perfil`.
- `subsistema 1─N opcion`, `subsistema 1─N clase`, `clase 1─N metodo`.
- `perfil N─M opcion` (`permiso_opcion`) y `perfil N─M metodo`
  (`permiso_metodo`): estas tablas intermedias **son** el permiso.
- `usuario 1─N refresh_token`: los refresh tokens JWT con rotación por
  familias (`familia_id`), adicionales a `express-session`.
- `recibo_pago` = cabecera (una por persona por período); `detalle_recibo` =
  líneas, cada una con un **único origen** (CHECK en la BD).
- `pre_nomina 1─1 periodo_nomina` (`UNIQUE (periodo_nomina_id)`) y
  `pre_nomina 1─N pre_nomina_recibo 1─N pre_nomina_detalle`, todo con
  `ON DELETE CASCADE`: el borrador se borra entero.
- `cuota_prestamo 1─1 detalle_recibo`: una cuota se descuenta una sola vez.

Reglas que el DBML no expresa (van en la BD): una sola cuenta principal
activa por persona (índice parcial), un solo contrato `VIGENTE` por persona
sin solapamiento, al menos un origen en `detalle_recibo`, y
`recibo_pago` `PAGADO` exige `fecha_pago` y `metodo_pago`. Ver skill
`nomina-postgres-neon`.

## Dinero y cálculo de nómina

Resumen; el detalle y los casos de prueba obligatorios viven en la skill
`nomina-dominio`.

- **Neto = asignaciones − deducciones.** Las líneas `APORTE_PATRONAL` son
  costo del patrono: no suman a ninguna columna del neto y se reportan
  aparte.
- Toda suma sobre `Detalle_recibo` **filtra por `Concepto.Tipo_concepto`**;
  olvidar el filtro rompe el neto.
- **Aportes de ley:** solo si hay `Afiliacion_ley` `ACTIVO`, con el
  `Parametro_aporte_ley` vigente en el período; base acotada por `Piso_base`
  y `Tope_base`; cada línea guarda `Parametro_aporte_id`, `Base_calculo` y
  `Tasa_aplicada` para explicar el monto años después.
- **Las tasas nunca van en el código.** Viven en `Parametro_aporte_ley` con
  vigencia: cuando la ley cambia, se cierra la fila vieja y se crea una
  nueva; los recibos viejos conservan la tasa que usaron.
- **El saldo de un préstamo no se guarda:** es la suma de las cuotas
  `PENDIENTE`. Un campo calculado se desincroniza.
- `Recibo_pago` unique por (`Persona_id`, `Periodo_Nomina_id`). Un período
  `PROCESADO`/`PAGADO` es inmutable.

## Testing y verificación

Todavía **no hay pruebas automatizadas**. Mientras no las haya, la
verificación de una tarea es una **prueba manual reproducible** o una llamada
real al endpoint (`curl`), y así debe quedar escrito en la tarea.

Cuando se agreguen pruebas, la regla es la de la constitución nº 6: cada
prueba debe poder correr sin dejar datos sucios (transacción con `ROLLBACK`
o datos desechables), y ninguna prueba depende de otra.

## Entornos y conexión

| | Desarrollo (laptop) | Producción (despliegue) |
|---|---|---|
| Base | PostgreSQL en Neon, branch de desarrollo | PostgreSQL en Neon |
| API | `npm run dev` (`nodemon`) | contenedor / servicio |
| Secretos | `.env` (no versionado) | variables de entorno |

- `DATABASE_URL` es la única cadena de conexión (con `sslmode=require`). Si
  falta, `src/config/database.js` falla al arrancar; fallar rápido es la
  política.
- Para un servidor que se reinicia a menudo conviene la cadena **pooled**
  (host `-pooler`) de Neon.
- `.env` está en `.gitignore`: nunca se versiona.

## Migraciones

- `db/init.sql` es el **esquema base** (v8, 27 tablas, snake_case) y **no
  lleva número**: se corre **una vez** sobre una base vacía.
- Los **cambios posteriores** sobre una base con datos van en
  `db/migrations/NNN_nombre.sql` (**número primero**), uno por cambio. La
  carpeta existe aunque hoy esté vacía.
- **Antes de correr una migración o recrear el esquema en Neon, crear un
  branch**: es el respaldo y el rollback (instantáneo). El borrón y cuenta
  nueva se hace en un branch nuevo, no encima de la base en uso.
- Al cambiar el esquema se edita `db/init.sql`/la migración y `db/schema.dbml`
  en el **mismo cambio** (espejados 1:1).
- Envolver el cambio en `BEGIN; ... COMMIT;`: en PostgreSQL el DDL es
  transaccional. Nunca se edita una migración ya aplicada; se crea la
  siguiente. Ver skill `nomina-postgres-neon`.

## Aprendizajes y errores a evitar

- **`node-pg` devuelve `DECIMAL` como texto.** Sumarlos con `+` concatena
  cadenas. Ver skill `nomina-dominio`.
- **Un `NULL` dentro de un `VALUES` sin tipo se resuelve como `text`.** Al
  insertar desde `VALUES (... NULL, NULL ...)` en una columna `decimal`, hay
  que castear explícitamente (`NULL::numeric(12,2)` o `v.col::numeric`), o
  PostgreSQL falla con "column is of type numeric but expression is of type
  text". Le pasó a la 004 en `parametro_aporte_ley`.
- **La cookie de sesión viaja con `credentials: 'include'`**; sin eso el
  navegador no manda `connect.sid` y el `403`/`401` aparece "sin razón".
- **Un `Pool`, no una conexión por petición.** Varias sentencias que deben ir
  juntas usan `db.transaction` (`pool.connect()` + `BEGIN/COMMIT`,
  `ROLLBACK` en `catch`, `release()` en `finally`), no `pool.query` suelto:
  cada `pool.query` puede caer en una conexión distinta.
- **El orden de `executeMethod` no se negocia** (forma → permiso → reflexión →
  ejecución). Es el error más caro de corregir después.
- **Proteger el menú no protege nada.** El listado de opciones del front es
  comodidad; el permiso real se valida en el servidor.
- **Los nombres de métodos son la llave** del mapa: si `Metodo.Nombre` de la
  BD no es idéntico al nombre de la función, la reflexión falla con `501`.
- **`hasOwnProperty(Clase.prototype, method)` no bloquea `constructor`**:
  `constructor` también es propio del prototipo. Hay que excluirlo aparte
  (`method !== "constructor"`) y exigir que sea función; `toString` y
  `__proto__` sí quedan fuera porque no son propios del prototipo.
- **`ON DELETE RESTRICT` lanza `restrict_violation` (23001)**, no
  `foreign_key_violation` (23503). Manejar ambos al traducir errores. Ver
  skill `nomina-postgres-neon`.
- **Los mapas de permisos viven en el proceso.** `setPermissionMethod`
  actualiza solo la instancia que atendió la escritura. Con varias instancias
  hay que publicar el cambio (pub/sub) o llamar `reloadPermissions` en cada
  nodo; en este proyecto hay una sola. Ver spec 009.
- **La unicidad de `perfil.nombre_perfil` en la BD distingue mayúsculas.** El
  BO compara con `LOWER()` para que `Contador` y `contador` no convivan, pero
  no hay índice único funcional: dos creaciones simultáneas podrían pasar las
  dos. Se documenta; agregar el índice implica cambio de esquema (spec 010).
- **Renombrar un perfil no rompe permisos ni usuarios.** Las llaves de los
  mapas y las FKs usan `perfil_id`; la sesión refresca los nombres en la
  siguiente petición. Por eso `editarPerfil` no recarga `PermissionMethodMap`.
- **`req.session.profiles` puede no traer nombres.** El camino de access token
  guarda ids; la guarda de escalada consulta los nombres con
  `findActiveProfilesByIds` en vez de confiar en `detallesPerfiles`.
- **`GROUP BY` debe incluir toda columna no agregada.** `findAllOptionsAdmin`
  agrega `s.id AS subsistema_id` para que el front pueda crear opciones en ese
  subsistema; sin agregar `s.id` al `GROUP BY`, PostgreSQL responde `42803`.
  Las pruebas con base falsa no ven SQL: el E2E real sí.
- **Ocultar una opción no revoca el método.** No existe relación
  `opcion ↔ metodo` en el esquema: quitar la opción del menú deja el endpoint
  ejecutable si el permiso de método sigue concedido. Se avisa en el front.
- **`setPermissionOption` exige los seis campos** (`id`, `nombre`, `orden`,
  `descripcion`, `subsistema`, `perfilId`); con datos incompletos el menú
  pinta `undefined`. `asignarPermisoOpcion` los arma desde la fila de la BD.
- **Renombrar o desactivar una opción exige recargar el mapa.** La llave es
  `Subsistema_nombre_perfilId` y el nombre vive dentro del valor; por eso
  `editarOpcion` y `cambiarEstadoOpcion` llaman `loadPermission`. Desactivar
  no borra `permiso_opcion`: reactivar restaura el acceso.
- **El nombre de una opción no puede llevar `_`.** La llave del mapa usa `_`
  como separador; permitirlo volvería ambiguas dos combinaciones distintas.
  Se valida 2–80 alfanuméricos empezando por letra.
- **`registro_horas` tiene `UNIQUE (persona_id, fecha)`.** Cualquier alta de
  horas para un día ya registrado debe ser upsert; un `INSERT` responde `23505`
  y, si se ignora, la extra se pierde. `registrarExtra` suma sobre la fila
  existente y conserva `horas_normales`.
- **`Horas.eliminar` borra la fila completa.** Para quitar solo la extra hay
  que mirar `horas_normales`: si es 0 se borra, si es > 0 se actualiza
  `horas_extra = 0`. Reutilizar `eliminar` habría destruido las horas normales
  de RRHH.
- **El rol `superuser` del front no distingue Administrador de Superusuario.**
  `profileToRole` mapea ambos a `superuser`; una pantalla exclusiva del segundo
  necesita `hasProfile(user, 'Superusuario')` además del `RoleRoute`. La
  autorización real sigue en `permiso_metodo`/`permiso_opcion`.
- **El menú se filtra por perfil activo, no por rol.** `Superusuario` y
  `Administrador` comparten el rol `superuser`, y `RRHH`/`GerenteRRHH`
  comparten `rrhh`; filtrar por rol en el front mezclaba perfiles distintos y
  dejaba ver `Seguridad` a `Empleado` o `RRHH`. `Security/Menu/getOptions`
  acepta un `perfilId` opcional, valida que pertenezca a `req.session.profiles`
  (`403` si no) y devuelve solo las opciones de ese perfil. Sin argumento
  conserva la unión de perfiles (compatibilidad y menú anónimo vacío).
- **`getOptions(perfilId)` no confía en el cliente.** El `perfilId` se valida
  como entero positivo (`400`) y contra los perfiles reales de la sesión
  (`403`). Un usuario con varios perfiles no puede pedir el menú de uno que no
  tiene; el backend sigue siendo la autoridad.
- **La caché del menú en el front es por `perfilId`, no por rol.** Al cambiar
  de perfil se reutiliza la respuesta cacheada de ese perfil y se invalida
  entera cuando la administración de opciones fuerza un refresco (`force`),
  porque el cambio pudo afectar a cualquier perfil del usuario.
- **`FOR UPDATE OF pn` necesita el alias de la tabla bloqueada.** El borrador
  se bloquea con `SELECT ... FROM pre_nomina pn ... FOR UPDATE OF pn`; sin el
  `OF pn` PostgreSQL intenta bloquear también el `periodo_nomina` del `JOIN` y
  la transacción queda esperando un lock que ya tiene. Orden de bloqueo:
  período → borrador, siempre el mismo, para no interbloquear.
- **El borrador es un snapshot; no se recalcula al confirmar.** `confirmar`
  copia las líneas del borrador tal cual (con su `base_calculo`,
  `tasa_aplicada` y `monto`) y no vuelve a llamar al calculador. Si entre
  `generar` y `confirmar` apareció una novedad o venció una cuota, se responde
  `409` y se pide regenerar: recalcular en silencio haría que el recibo no
  coincida con lo que RRHH vio y editó.
- **`monto > 0` en `pre_nomina_detalle` obliga a borrar la línea `LEY` que baja
  a cero.** Al editar el sueldo hacia abajo, el aporte patronal o de ley puede
  quedar en 0; un `UPDATE ... SET monto = 0` viola el CHECK. El recálculo
  borra la fila cuando el monto da 0 y la inserta cuando vuelve a ser > 0.
- **`guardar` reemplaza, no parchea.** Por cada recibo enviado se conservan
  las líneas con `id` (validando que sean editables) y se borran las
  editables omitidas; después se insertan las líneas con `id: null` como
  `MANUAL`. Un recibo no enviado queda intacto, y `recibos: []` es `400`.
  El borrado de editables debe correr **antes** de insertar las `MANUAL`, o el
  barrido se lleva la línea recién creada.
- **La cascada del borrador está en la BD.** `pre_nomina_detalle` y
  `pre_nomina_recibo` cuelgan de `pre_nomina` con `ON DELETE CASCADE`, y
  `pre_nomina` de `periodo_nomina` también: borrar el período no deja huérfanos.
  Aun así `eliminar` borra la cabecera dentro de una transacción y devuelve
  cuántas filas se llevó.
- **`confirmar` valida por id, no por conteo.** Marca `APLICADA` solo las
  novedades y `DESCONTADA` solo las cuotas que están en el borrador; después
  cuenta las que quedaron aprobadas/pendientes **fuera** del borrador y
  responde `409` si hay alguna. Comparar totales daría falsos positivos con
  dos novedades del mismo período.
- **Una cuota repetida en el recibo final llega como `23505`, no `23503`.**
  `detalle_recibo.cuota_prestamo_id` es único en la práctica; `confirmar`
  traduce el `23505` a `409` con un mensaje que pide regenerar. `Period.procesar`
  ya tenía la misma guarda.
- **El test con base falsa necesita simular `findPeriodoByIdForUpdate` y
  `findPreNominaByPeriodo`.** Al refactorizar `Period.procesar` cambian las
  consultas que ejecuta; si el doble no las conoce, el test falla con
  "Consulta no simulada" y no con el comportamiento real.
- **`archify` no admite tarjetas de más: el visor desborda el alto.** Con
  cuatro tarjetas largas el `visual-check` fallaba a 1440×900 (scrollHeight
  1037) y a 1600×1000; con cuatro tarjetas de 2–3 ítems y el diagrama en tres
  filas (60/220/360) pasa en los cuatro tamaños. Si se agrega contenido,
  recortar tarjetas antes que nodos o tipografía.
- **`res.clearCookie` con `maxAge` no borra la cookie.** Express reescribe
  `expires` al futuro cuando recibe `maxAge` positivo; la cookie queda viva con
  valor vacío. Las cookies de token se borran con
  `tokenService.opcionesBorradoCookie()`, que no lleva `maxAge`.
- **El sid del store no es el valor de la cookie.** `connect.sid` viaja firmado
  (`s:<sid>.<firma>`); para buscar la fila en `sesion` hay que quitar el `s:` y
  la firma. Comparar el valor crudo de la cookie con `sid` siempre da 0 filas.
- **`dotenv` "injected env (0)" no significa que falte `.env`.** Significa que
  todas las variables ya estaban en `process.env` (otro import las cargó
  antes). No es un error de configuración.
- **El límite de login por IP se prueba con `X-Forwarded-For` y un usuario
  inexistente.** Así no se bloquea una cuenta real ni la IP del desarrollador;
  con `trust proxy` 1 Express toma esa cabecera como `req.ip`. En producción
  eso exige estar detrás de un proxy de confianza.
- **CORS y CSRF deben leer la misma lista de orígenes.** Si CORS usa
  `FRONTEND_URLS` y el chequeo de origen usa `FRONTEND_URL`, configurar una
  sola deja el front bloqueado por un lado y abierto por el otro. La fuente
  única es `src/config/http.js`.
- **Un origen ajeno no debe hacer que CORS lance una excepción.** Con
  `callback(new Error(...))` el error cae en el handler genérico y responde
  `500`; lo correcto es no emitir cabeceras CORS y dejar que
  `verificarOrigen` responda `403` en los métodos que cambian estado.
- **Permitir peticiones sin `Origin`/`Referer` no abre CSRF.** Un navegador
  manda `Origin` en un POST cross-site y `SameSite=Lax` no envía la cookie;
  bloquear a los clientes sin `Origin` solo rompe curl y los E2E.
- **`pnpm` 12 ya no lee `pnpm.overrides` de `package.json`.** Los overrides
  viven en `pnpm-workspace.yaml`; en `package.json` se ignoran con un warning
  y `pnpm audit` sigue viendo las versiones viejas.
- **Validar largos antes de la transacción convierte un `22001` en un `400`
  útil.** Sin esa validación, un nombre de 61 caracteres o un email de 121
  llegan a PostgreSQL y el usuario recibe un `500` que no dice qué campo
  corregir.
- **Los textos libres de `Payroll` también tienen tope.** `observacion`,
  `descripcion`, `referencia_pago`, `nro_afiliacion` y `motivo` llegaban
  directo a la BD; un texto largo devolvía `22001` (500). Ahora pasan por
  `textoService.opcional`/`requerido`, que recorta y responde `400` con el
  campo y el máximo.
- **El selector de personas no debe traer la fila completa.** `findAllPersonas`
  devolvía `email` y `monto_salario`, que el front no usa. Recortar la consulta
  a los campos que la pantalla pinta reduce la PII y el salario expuestos sin
  tocar permisos ni contratos del endpoint.
- **`pre_nomina_e2e.mjs` no corre en el branch de desarrollo con el seed de
  demo.** Los contratos de demo no tienen fecha de fin y quedan vigentes en
  cualquier período futuro; el script aborta si hay más de un contrato en su
  período. Necesita un branch desechable, no es una regresión.
- **`COUNT()` vuelve como `bigint` y `node-pg` lo entrega como texto.** El
  resumen de nómina convierte `personas` a `Number` en el BO; dejarlo como
  string hace que el front compare `"3"` con `3` y falle.
- **El aporte patronal no está en `recibo_pago`.** `total_asignaciones` y
  `total_deducciones` no lo incluyen; sumarlo desde `detalle_recibo`
  (`tipo_concepto = 'APORTE_PATRONAL'`) es la única forma de reportarlo, y
  nunca debe sumarse al neto. El costo total es `asignaciones + patronal`.
- **El `LATERAL` del histórico necesita `r.id` y `GROUP BY p.id, pn.id`.**
  Si el lateral se apoya en una columna no agrupada, PostgreSQL responde
  `42803`; y un `SUM` sobre `recibo_pago` sin filtrar `ANULADO` infla los
  totales.
- **`node-pg` entrega `DATE` como `Date`, no como texto.** Al serializar a
  JSON, `fecha_fin` sale como `"2026-11-19T04:00:00.000Z"` y el contrato del
  API promete `"2026-11-19"`. `Employee` normaliza sus fechas con `aFechaISO`
  en el borde; no se cambió el parser global de `pg` porque afectaría a todos
  los BO.
- **`pdfkit` no debe escribir por debajo de `page.maxY()`.** Un pie dibujado
  fuera del área de texto (incluido dentro de un handler `pageAdded`) dispara
  `continueOnNewPage` y entra en recursión infinita. El pie va dentro del
  margen inferior (`page.height - margins.bottom - 22`).
- **`despedir` debe incluir el contrato `FINALIZADO` del período en la
  nómina.** `findContratosVigentesPorFrecuencia` filtraba `estado = 'VIGENTE'`
  y `persona.estado = 'ACTIVO'`; una persona despedida a mitad de período
  desaparecía. Ahora incluye `FINALIZADO` con `fecha_fin BETWEEN $1 AND $2` y
  el prorrateo se hace por días.
- **La sesión se borra por `sess->>'userID'`, no por el sid.** El valor de
  `connect.sid` viaja firmado (`s:<sid>.<firma>`); la tabla `sesion` guarda el
  sid sin firma y el JSON con el `userID`. Para cerrar las sesiones de un
  usuario despedido se filtra por `sess->>'userID'`.
- **Un despido es una transacción de cinco tablas.** Orden fijo persona →
  contrato para no interbloquear; después `despido`, `persona`, `usuario`,
  `refresh_token` y `sesion`. Si algo falla, el `ROLLBACK` deja todo como
  estaba (la persona no queda a medias entre activa y despedida).
- **Sembrar una opción por migración exige recargar los permisos en memoria.**
  `PermissionOptionMap` se llena al arrancar (`src/index.js`); si la opción se
  inserta en la BD con el servidor ya vivo, `getOptions` no la devuelve hasta
  llamar `Security/Admin/reloadPermissions` o reiniciar. El E2E del front lo
  recarga antes de comprobar el menú.
- **El E2E de despidos crea usuarios desechables y los borra en `finally`.**
  No procesa períodos: verificar la inclusión en la nómina con la consulta
  del período y el prorrateo con el calculador evita tocar los recibos y las
  cuotas de la demo. `despido` se borra antes que `contrato` por la FK.
- **Un período `PROCESADO` no admite pre-nómina.** `PreNomina.generar` exige
  `BORRADOR`, igual que `Period.procesar`. El demo movió su borrador de
  ejemplo a `Semana 4 de noviembre 2026`: regenerar sobre la quincena 1 de
  noviembre (ya cerrada) daba `409`. Al ampliar el seed, revisar siempre qué
  períodos quedan en `BORRADOR` antes de apuntar el script.
- **`psql` se colgó en este entorno al aplicar el seed** (proceso `S<` sin
  conexión abierta en la BD). Aplicar el SQL con un cliente `pg` del proyecto
  (`new pg.Client(...).query(sql)`) funciona y respeta `DATABASE_URL`; el
  helper temporal no se versiona.

## Decisiones de diseño

Registro de decisiones con su motivo. Las viejas no se editan: si una cambia,
se agrega una nueva que la reemplaza.

### 2026-11-20

- **La opción `Reportes` es solo de `RRHH` y `Superusuario`.** Se siembra con
  la migración de datos 019 y el `DELETE` final revierte cualquier grant que
  el seed hubiera concedido a otros perfiles al reejecutarse. Motivo: es la
  misma audiencia de `Personas`, `Despidos` y `PreNomina`; `Administrador`
  opera `Payroll` pero no administra ni reporta la nómina completa.
- **La pantalla de reportes no agrega contrato de API.** Reutiliza los cuatro
  métodos ya sembrados para el resumen, el detalle de períodos y el PDF.
  Motivo: un endpoint de reporte agregaría una segunda verdad sobre los mismos
  totales y obligaría a mantener permisos nuevos; la vista solo agrega datos
  ya autorizados.
- **`admin_prueba` entra en nómina por datos, no por código.** El seed le da
  contrato, salario, cuenta, afiliaciones y un recurrente derivando el
  `persona_id` desde `usuario.username`; no se tocó `findContratosVigentesPorFrecuencia`
  ni `Receipt.misRecibos`. Motivo: el perfil `Empleado` ya estaba asignado y el
  BO solo devuelve recibos de quien tiene contrato en el período; darle
  un caso de prueba realista valida el flujo completo sin ramas especiales.
- **Los nuevos períodos nacen en `BORRADOR` y el demo elige cuáles cerrar.**
  Se procesan cronológicamente dos quincenas, `Diciembre 2026` y `Semana 3 de
  noviembre 2026`; los otros quedan listos para probar `procesar` desde la
  pantalla. Motivo: dejar todos abiertos no genera recibos y cerrarlos todos
  quita material de prueba; la nómina cerrada es inmutable.

### 2026-11-19

- **El resumen de nómina es de solo lectura y se calcula al vuelo.** No se
  guardan totales en una tabla: `resumen` y `listarConTotales` suman
  `recibo_pago`/`detalle_recibo` en cada consulta. Motivo: un total
  persistido se desincroniza en cuanto se anula un recibo o se paga el
  período, y la nómina ya es inmutable cuando está `PROCESADO`/`PAGADO`.
- **El aporte patronal se reporta aparte y suma al costo, no al neto.**
  `recibo_pago` no tiene columna de patronal; se agrega desde
  `detalle_recibo` y se expone como `total_aporte_patronal`, con
  `costo_total = asignaciones + aporte_patronal`. Motivo: sumarlo al neto
  haría que el recibo del empleado no cuadre con el total del período.
- **Los permisos del resumen son los mismos de `Period`.** `RRHH`,
  `GerenteRRHH`, `Administrador` y `Superusuario`; `Empleado` no ve totales
  de la nómina completa. No hay opción de menú nueva: el resumen vive dentro
  de la pantalla de períodos.
- **El PDF del recibo se genera en el servidor y viaja en base64.** `pdfkit`
  arma el documento en memoria y `generarPdf` devuelve
  `{ nombreArchivo, mimeType, tamanioBytes, contenidoBase64 }`. Motivo: el
  cliente no tiene que replicar el formato ni exponer un endpoint de archivos
  con otra autenticación; el sobre de `/execute` ya valida sesión y permiso.
- **La pertenencia del recibo se valida en el BO, no en el mapa de
  permisos.** El permiso `generarPdf` es el mismo para gestores y `Empleado`;
  `esGestorNomina` decide si puede ver cualquiera y, si no, se compara
  `recibo.persona_id` con la persona de la sesión (`403`). Motivo: el mapa es
  por perfil y no por fila; un permiso por recibo obligaría a un mapa
  dinámico.
- **El despido es una operación de negocio, no un `DELETE`.** `despido`
  guarda el motivo y la fecha; el contrato pasa a `FINALIZADO`, la persona a
  `INACTIVO` y el usuario a `activo = false`. Motivo: el histórico laboral y
  la nómina necesitan las filas; borrar dejaría recibos huérfanos y rompería
  las FKs.
- **Un contrato se cierra una sola vez (`UNIQUE (contrato_id)`).** El
  segundo intento responde `409` antes de tocar nada. Motivo: dos despidos
  del mismo contrato harían ambiguo el motivo y la fecha de la baja.
- **La nómina del período incluye al despedido y prorratea el sueldo fijo.**
  `findContratosVigentesPorFrecuencia` acepta `FINALIZADO` con `fecha_fin`
  dentro del período; `sueldoPeriodoProporcional` paga solo los días
  trabajados. Motivo: la persona trabajó hasta su fecha de egreso; sacarla
  del período le quitaría el sueldo ya devengado.
- **`Employee` normaliza las fechas DATE a `YYYY-MM-DD` en el borde.** No se
  cambió el parser global de `pg`: otros BO ya consumen `Date` y un cambio
  global alteraría sus contratos sin aviso.

### 2026-11-16

- **La sesión vive en PostgreSQL, no en `MemoryStore`.** Migración
  `015_sesion.sql` y `src/database/SessionStore.js`. Motivo: `MemoryStore`
  pierde las sesiones al reiniciar, no se comparte entre instancias, no se
  puede invalidar desde otro nodo y su mapa crece sin límite. La tabla guarda
  solo el JSON de `express-session` (userID, perfiles, banderas), nunca
  contraseñas ni hashes, y se barre por `expira_en` cada 15 minutos.
- **Una sola fuente de orígenes para CORS y CSRF.** `src/config/http.js`
  exporta `origenesPermitidos`, `esOrigenPermitido` y `cookieSegura`. Motivo:
  CORS leía `FRONTEND_URLS` y el chequeo de origen leía `FRONTEND_URL`;
  configurar una sola variable dejaba el front bloqueado o el endpoint abierto.
- **`verificarOrigen` se aplica a todo método que cambia estado, no solo a
  `logout`/`refresh`.** Cubre también `login` y `/execute`. Sin `Origin` ni
  `Referer` se deja pasar (curl, scripts, clientes servidor-a-servidor);
  `SameSite=Lax` y el navegador que siempre manda `Origin` en un POST
  cross-site son la barrera real.
- **El límite de fallos de login es por IP y cuenta solo 4xx.** 10 fallos en
  15 minutos (configurable), `429` con `Retry-After`, y un acierto limpia el
  contador. Motivo: frena la fuerza bruta distribuida sin bloquear logins
  legítimos repetidos (demos, E2E) ni contar los propios 429. El bloqueo por
  cuenta sigue siendo la defensa principal; con varias instancias el contador
  habría que compartirlo.
- **`cambiarClave` revoca todos los refresh tokens y borra las cookies de
  token.** Motivo: si la clave se cambia porque estaba comprometida, un refresh
  token robado no debe seguir sirviendo. La sesión actual sobrevive (sigue
  autenticada por `connect.sid`); el front vuelve a autenticarse para obtener
  tokens nuevos. Además se rechaza reutilizar la clave actual.
- **`registrar` valida en el borde, antes de la transacción.** Largos,
  formatos, fechas reales, enums y `monto > 0`. Motivo: los `varchar` de la BD
  convertían un dato largo en `22001` y el cliente recibía un `500` sin saber
  qué campo corregir; un email sin `@` o un username con espacios no deben
  llegar a la BD.
- **No se cifra a nivel de aplicación la PII ni `nro_cuenta`.** Se evaluó y se
  descartó: rompe los `UNIQUE` (cédula, email, `(banco_id, nro_cuenta)`), la
  idempotencia de los seeds y hoy ningún BO lee el número de cuenta. La
  protección es TLS en tránsito (verificado por defecto), cifrado en reposo de
  Neon y acceso restringido. Queda como riesgo residual documentado en
  `docs/auditoria-seguridad.md`; si se exige, primero hay que decidir cómo se
  busca por cédula/email.
- **Se fijan `body-parser 2.4.0` y `qs 6.17.1` con `overrides`.** Motivo:
  `pnpm audit --prod` reportaba un DoS en `body-parser 2.3.0` y un TypeError en
  `qs 6.16.0`, ambos transitivos de `express`. En pnpm 12 los overrides viven
  en `pnpm-workspace.yaml`, no en `package.json`.
- **Los topes de texto viven en un solo servicio y en un solo módulo del
  front.** `src/services/TextoService.js` (backend) y
  `src/constants/inputLimits.ts` (front) replican los `varchar` de la BD. Un
  campo nuevo toma su valor de ahí: el backend responde `400` con el máximo y
  el front corta con `maxLength`, en vez de dejar que cada pantalla invente su
  número.
- **`listarPersonas` devuelve solo lo que la pantalla pinta.** Se quitaron
  `email` y `monto_salario`; el selector de nómina usa nombres, cédula y cargo,
  y la tabla de usuarios usa `username`, `usuario_activo` y el contrato.
  Motivo: el endpoint lo consumen tres pantallas y devolver la fila completa
  exponía PII y salario sin que nadie los mostrara.

### 2026-11-15

- **La pre-nómina es una tabla aparte, no un estado del período.** Tres tablas
  (`pre_nomina`, `pre_nomina_recibo`, `pre_nomina_detalle`) y ninguna columna
  de estado: el borrador existe o no existe. Motivo: `recibo_pago` es la
  única verdad de una nómina cerrada; guardar el borrador en las mismas tablas
  obligaría a marcar filas como "provisional" y a limpiarlas en cada consulta.
- **Un borrador por período (`UNIQUE (periodo_nomina_id)`).** Rehacerlo es
  `eliminar` + `generar`. Motivo: dos borradores competirían por las mismas
  novedades y cuotas, y `confirmar` no sabría cuál es la verdad.
- **El borrador se borra al confirmar.** No queda snapshot: el recibo final es
  la verdad. Motivo: un snapshot congelado se desincroniza del recibo en
  cuanto alguien corrige algo, y nadie sabría cuál mirar.
- **Solo `CALCULADA` y `MANUAL` son editables.** Una novedad, una cuota o un
  concepto recurrente se corrige en su pantalla y se regenera. Motivo: una
  sola verdad; el recibo final siempre coincide con el origen que lo produjo.
  El backend calcula `editable`, el front no lo adivina.
- **`PayrollWriter` concentra cálculo y escritura.** Vive en
  `src/bo/Payroll/PayrollWriter.js`, no está sembrado en `metodo` y no es
  invocable por `/execute`; `Period.procesar` y `PreNomina.confirmar` lo usan.
  Motivo: el borrador y el recibo final eran dos copias del mismo cálculo que
  tarde o temprano divergen.
- **`Period.procesar` responde `409` si hay borrador sin confirmar.** Motivo:
  procesar por detrás del borrador dejaría a RRHH editando una pre-nómina que
  ya no se va a usar; el mensaje pide confirmarla o eliminarla.
- **Permisos solo para `RRHH` y `Superusuario`.** `Administrador` opera el
  resto de `Payroll` pero no la pre-nómina; `Empleado` no la ve. El front
  valida por **nombre de perfil** (`RRHH`/`Superusuario`), no por rol, porque
  `Administrador` comparte el rol `superuser`. La opción de menú `PreNomina`
  (Payroll, orden 10) se siembra con los mismos dos perfiles.

### 2026-11-10

- **El sidebar se filtra por perfil activo, no por rol.** `Security/Menu/getOptions`
  acepta un `perfilId` opcional: valida que pertenezca a la sesión (`403`) y
  devuelve solo las opciones de ese perfil. El front manda
  `user.activeProfile.id` y cachea el menú por perfil. Motivo: `Superusuario` y
  `Administrador` comparten el rol `superuser`, y `RRHH`/`GerenteRRHH` el rol
  `rrhh`; el filtro por rol dejaba ver `Seguridad` a perfiles que no la tienen
  asignada. Sin argumento, `getOptions` conserva la unión de perfiles para no
  romper el menú anónimo ni a los clientes viejos.
- **Horas extras también para RRHH.** La `013_horas_extras_rrhh.sql` concede
  los tres métodos de `Payroll/Hours` y la opción `HorasExtras` a `RRHH` y
  `GerenteRRHH`. Motivo: RRHH registra las horas del personal y la 012 los
  había dejado fuera. `Administrador` sigue sin acceso (no se pidió) y la
  pantalla valida por nombre de perfil porque comparte el rol `superuser`.
- **La caché del menú se invalida completa al forzar un refresco.** Editar una
  opción desde `Security/Admin` puede afectar a cualquier perfil del usuario,
  no solo al activo; `fetchMenu(perfilId, true)` limpia la caché y vuelve a
  pedir el perfil activo.
- **Las horas extras reutilizan `registro_horas.horas_extra`.** No se crea una
  tabla `registro_hora_extra` ni cambia el esquema. Motivo: la columna ya
  existe, el cálculo del recibo ya paga `horas_extra × tarifa × 1.5` y una
  tabla paralela obligaría a tocar `Period.procesar` y el espejo DBML. La
  migración `012_horas_extras.sql` es solo de datos.
- **`registrarExtra` hace upsert, no insert.** El `UNIQUE (persona_id, fecha)`
  impide una segunda fila para el mismo día. Si RRHH ya registró horas
  normales, la extra se **suma** sobre esa fila con
  `ON CONFLICT ... DO UPDATE`; así no se pierden las normales ni se duplica el
  sueldo base de un contrato `POR_HORA`.
- **`quitarExtra` conserva las horas normales.** Si `horas_normales > 0` pone
  `horas_extra = 0`; solo borra la fila completa cuando el día tenía únicamente
  extras. Motivo: reutilizar `Hours.eliminar` habría borrado también las horas
  normales que RRHH registró.
- **La pantalla de extras es un acceso adicional, no un reemplazo.** La
  pantalla `Horas` sigue igual para RRHH y Superusuario (horas normales y
  extra). Las extras quedan además en una pantalla exclusiva de
  `Superusuario`. Motivo: pedido explícito; centralizar las extras sin quitarle
  a RRHH el registro diario.
- **Permiso y menú solo para `Superusuario`.** Los tres métodos se siembran con
  `permiso_metodo` únicamente para ese perfil y la opción `HorasExtras`
  (Payroll, orden 9) solo con `permiso_opcion` para él. El E2E comprueba que
  RRHH recibe `403` en los tres métodos y no ve la opción.
- **Guard fino en el front por nombre de perfil.** `RoleRoute allow=
  {['superuser']}` deja pasar también a `Administrador` (se mapea a
  `superuser`), por eso `OvertimePage` valida `hasProfile(user,
  'Superusuario')` y muestra una tarjeta de acceso restringido. El servidor
  sigue siendo la autoridad: ocultar el menú no revoca el método.
- **`listarExtrasPorPeriodo` filtra `horas_extra > 0`.** Devuelve las filas
  mixtas (con normales y extras) para que el front pueda avisar si al quitar
  la extra se conservan las normales o se elimina la fila.

### 2026-11-09

- **El catálogo de opciones se administra desde el BO.** `Security/Admin`
  expone `listarOpciones`, `crearOpcion`, `editarOpcion` y
  `cambiarEstadoOpcion`, solo para `Superusuario`. Motivo: crear una opción o
  corregir su orden obligaba a escribir SQL. No hay borrado físico: se
  desactiva (`activo = false`) y `permiso_opcion` se conserva para que
  reactivar restaure el acceso.
- **Asignación perfil ↔ opción simétrica a la de métodos.**
  `listarPermisosOpcion`, `asignarPermisoOpcion` y `quitarPermisoOpcion`
  escriben primero en `permiso_opcion` y después actualizan
  `PermissionOptionMap` con `security.setPermissionOption`, sin reiniciar.
  `asignar` y `quitar` son idempotentes (`yaEstaba` / `yaNoEstaba`). Es la
  segunda interfaz que pedía el front: la de métodos es la spec 009.
- **`listarOpciones` trae `subsistemaId`, `perfiles` y `protegida`.**
  `subsistemaId` es lo que necesita `crearOpcion` (el front no puede inventar
  ids); `perfiles` cuenta solo perfiles activos que ven la opción, para avisar
  antes de desactivarla; `protegida` evita ofrecer acciones que darán `409`.
- **Guardas de opciones críticas.**
  `OPCIONES_CRITICAS = {Security/Opciones, Security/Permisos,
  Security/Perfiles, Security/Usuarios}`: quitar, renombrar o desactivar
  cualquiera en `Superusuario` responde `409`. Motivo: sin ellas nadie podría
  volver a administrar la seguridad desde el menú. La guarda es por nombre
  (`Subsistema/nombre`), no por id.
- **`crearPerfil` con plantilla opcional.** Tercer parámetro
  `perfilPlantillaId`: clona `permiso_metodo` y `permiso_opcion` de la
  plantilla en la misma transacción, después de los 6 permisos base. Motivo:
  un perfil nuevo que ve entradas que no puede ejecutar confunde al usuario.
  Sin plantilla, el contrato es idéntico al de la spec 010.
- **Sin cambio de esquema (011).** Se reutilizan `opcion`, `permiso_opcion`,
  `permiso_metodo` y `perfil`; `db/schema.dbml` no cambia. La migración 010
  solo inserta métodos, permisos y la opción `Opciones`.

### 2026-11-08

- **Administración de permisos de método en caliente.** `Security/Admin`
  expone `listarMetodos`, `listarPermisosMetodo`, `asignarPermisoMetodo` y
  `quitarPermisoMetodo`, solo para `Superusuario`. Motivo: cambiar quién
  ejecuta un método obligaba a escribir SQL y reiniciar el backend.
- **La base manda: primero `permiso_metodo`, después el mapa.** Si la
  escritura falla, el mapa no cambia. Los ids se validan como enteros
  positivos antes de consultar (`400`); perfil o método inexistente/inactivo
  es `404`. Asignar y quitar son idempotentes (`yaEstaba` / `yaNoEstaba`).
- **Guarda anti-bloqueo.** `Superusuario` no puede perder
  `Security/Admin/{listarMetodos,listarPermisosMetodo,asignarPermisoMetodo,quitarPermisoMetodo}`
  ni `Security/User/listarPerfiles` (`409`): sin ellos nadie podría volver a
  conceder permisos.
- **La opción de menú `Permisos` es exclusiva de `Superusuario`.** La
  migración 006 la crea (`Security`, orden 4) y borra el grant que el seed
  concede a `Administrador` para todas las opciones de `Security`. Motivo:
  re-ejecutar el seed no debe exponer la vista a otro perfil.
- **Sin cambio de esquema.** `permiso_metodo (perfil_id, metodo_id)` ya
  existía; 006 solo inserta datos. `db/schema.dbml` no cambia.
- **La vida del perfil se administra desde el BO.** `Security/Admin` expone
  `listarPerfilesAdmin`, `crearPerfil`, `editarPerfil` y
  `cambiarEstadoPerfil`; `Security/User` expone `establecerPerfilesUsuario`.
  Motivo: crear o corregir un perfil y asignarlo a un usuario obligaba a
  escribir SQL. No hay borrado físico: se desactiva (`activo = false`) y las
  FKs conservan el historial.
- **Reemplazo del conjunto de perfiles, no pares agregar/quitar.**
  `establecerPerfilesUsuario` hace `DELETE` + `INSERT` en una transacción: el
  cliente manda el conjunto final y no puede quedar un estado intermedio con
  dos peticiones concurrentes. Para pintar ese conjunto antes de reemplazarlo
  existe `listarPerfilesUsuario` (lectura, Superusuario y Administrador).
- **Un perfil nuevo nace usable.** `crearPerfil` inserta el perfil y sus 6
  permisos base de sesión en la misma transacción. Sin ellos, un usuario con
  solo ese perfil no podría ni cerrar sesión ni cambiar su clave.
- **Guarda de escalada de privilegios.** `PERFILES_PRIVILEGIADOS =
  {Superusuario, Administrador, GerenteRRHH}`. Un solicitante sin
  `Superusuario` que intente asignarlos recibe `403`, tanto en `registrar`
  como en `establecerPerfilesUsuario`. Motivo: sin la guarda, RRHH podía
  crearse un Administrador. La comprobación va dentro de la transacción y
  después de validar que los perfiles existen/están activos, así un id
  inválido sigue siendo `400`.
- **`Superusuario` es protegido por nombre.** No se renombra ni se desactiva
  (`409`), y no se puede quitar al último usuario activo que lo tiene (`409`,
  `contarOtrosSuperusuariosActivos` excluye al usuario editado). Motivo:
  renombrarlo rompería la guarda y dejar el sistema sin superusuarios lo
  dejaría sin administración.
- **La lectura de perfiles también es de `Administrador`.**
  `listarPerfilesAdmin` se concede a Superusuario y Administrador; las cuatro
  mutaciones quedan solo en Superusuario. `editarPerfil` no recarga el mapa:
  las llaves usan `perfil_id`, no el nombre; `crearPerfil` y
  `cambiarEstadoPerfil` sí (`loadPermission` filtra `pf.activo`).
- **Sin cambio de esquema (010).** Se reutiliza `perfil` y `usuario_perfil`;
  la migración 008 solo inserta métodos/permisos y corrige una descripción.
  `db/schema.dbml` no cambia.

### 2026-10-20

- **La sesión es su propio subsistema.** `Session` (antes clase dentro de
  `Security`) pasa al subsistema `Session`; `Security` conserva `Menu`, `Admin`
  y `User` (lo que es de seguridad: menú, administración y usuarios). El código
  se movió a `src/bo/Session/Session.js` y la BD con
  `db/init.sql` (la clase se mueve conservando su id, para no romper
  `permiso_metodo`). La llave del mapa pasa a
  `Session_Session_<metodo>_<perfilId>`. Motivo: un subsistema por dominio; la
  sesión no es una tarea de seguridad. Se conserva el nombre `Session` en el
  subsistema por coherencia con el naming en inglés del esquema.

- **Esquema consolidado en `db/init.sql` (v8, 27 tablas).** `init.sql` es el
  esquema base, sin número, y se corre una vez sobre una base vacía; los
  cambios posteriores sobre una base con datos van en
  `db/migrations/NNN_nombre.sql` (número primero). Las
  tablas transaccionales y `persona`/`usuario`/`refresh_token` usan `uuid`; las
  maestras usan `serial`. Se agrega `refresh_token` (JWT con rotación por
  `familia_id`) como **adicional** a `express-session`, no como reemplazo.
  Motivo: el borrón y cuenta nueva se hace en un branch de Neon; el esquema
  base queda en un solo archivo espejado con `db/schema.dbml`.

### 2026-10-14

- **Seguridad con el esquema del profesor.** `Rol` → `Perfil`;
  `Empleado` → `Persona` + `Usuario`; el usuario puede tener varios perfiles
  (`Usuario_Perfil`). Motivo: lo exigió el profesor; el perfil es quien
  recibe los permisos.
- **Los permisos son tablas intermedias, no una tabla `Permiso`.**
  `Permiso_Opcion` (qué ve el perfil) y `Permiso_Metodo` (qué ejecuta).
  Reemplaza a `Permiso`, `Perfil_Permiso` y `Perfil_Metodo`.
- **`Opcion` y `Metodo` son cosas distintas.** Opción = lo que se ve (menú,
  pantalla). Método = lo que el servidor ejecuta. Proteger solo el menú deja
  los endpoints abiertos.
- **Mapas de permisos en memoria** (`PermissionMethodMap`,
  `PermissionOptionMap`), cargados al arrancar con `loadPermission()`.
  Motivo: acceso O(1) sin consultar la BD en cada petición.
- **Llave del mapa con nombres, no con ids:**
  `Subsistema_Clase_metodo_perfilId`. Motivo: el JSON del cliente trae
  nombres. *Pendiente de confirmar con el profesor.*
- **Reflexión para despachar métodos** desde un único `POST /execute`, con
  tres defensas: permiso antes de la reflexión, nombres validados con regex
  y `hasOwnProperty` sobre el prototipo.
- **El saldo de un préstamo no se guarda.** Se calcula como la suma de las
  `Cuota_prestamo` pendientes. Un campo guardado se desincroniza.
- **Aportes patronales como líneas de `Detalle_recibo`** con concepto
  `APORTE_PATRONAL`. No suman a deducciones ni al neto.
- **Tasas de ley en `Parametro_aporte_ley` con vigencia.** Cuando la ley
  cambia se cierra la fila vieja y se crea una nueva; los recibos viejos
  conservan la tasa que usaron (`Parametro_aporte_id`).
- **Salario con historial** en `Contrato_salario`: un aumento es una fila
  nueva. La fecha de ingreso y egreso se derivan de `Contrato`, no se
  guardan en `Persona`.
- **Bonos:** puntuales por `Novedad`; recurrentes por `Concepto_persona`.
- **Una sola moneda.** Se quitaron `Moneda` y `Tasa_cambio`.
- **Pago dentro de `Recibo_pago`** (sin tabla `Pago`): un recibo se paga una
  vez. Se separa si aparecen pagos parciales.
- **Flujo SDD de 9 comandos** (`.opencode/commands/`), con la constitución
  en `docs/constitution.md`. Motivo: misma estructura que el proyecto de
  referencia (Civik).

## Reparto de responsabilidades

| Pregunta | Capa |
|---|---|
| ¿Cómo se ve esto en pantalla? | Frontend (otro repo) |
| ¿Qué se hace cuando pasa X? | Objeto de negocio (`src/bo/<Subsistema>/<Clase>.js`) |
| ¿Cómo se guarda o se trae de la base? | BO a través del componente de BD |
| ¿Puede esto pasar aunque el backend tenga un bug? | Base (constraint / índice / trigger) |

## Orden de construcción

| Fase | Qué se construye | Por qué en este orden |
|---|---|---|
| **0. Bootstrap + Sesión** ✅ | `src/index.js`, `src/app.js`, `config/database.js`, `src/database/Database.js`, login, `/api/me`, logout | Sin servidor ni sesión no hay nada que defender. **Hecha.** |
| **1. Esquema de de seguridad** | Migración (`Subsistema`, `Opcion`, `Clase`, `Metodo`, `Usuario_Perfil`, `Permiso_Opcion`, `Permiso_Metodo`), `db/schema.dbml`, seed de seguridad | Todo el resto (Security, menú, métodos) depende de estas tablas. Sin filas en `Metodo` y sus permisos, un método responde `403` aunque exista |
| **2. `Security.js`** ✅ | `loadPermission()`, los dos mapas y `executeMethod` (forma → permiso → reflexión → ejecución) | Es el corazón de la Seguridad que se defiende; se hace con el esquema ya en la BD |
| **3. `POST /execute`** ✅ | El endpoint en `src/routes/executeRoutes.js` + `src/controllers/executeController.js` | Es el único punto de entrada al negocio; a partir de aquí todo método nuevo cuelga de acá. **Hecha.** |
| **4. Primer BO de punta a punta** | Un BO simple (p. ej. `Persona`) + su `Metodo` y permisos | Valida el flujo completo `execute → Security → BO → BD` con el menor riesgo, antes de tocar cálculo |
| **5. Front** | Login, menú desde `PermissionOptionMap`, componentes `ui-*` | El menú sale del servidor, no está escrito a mano |
| **6. Contratos y salarios** | `Contrato`, `Contrato_salario` (historial de aumentos) | Base del cálculo: sin contrato y salario no hay nómina |
| **7. Aportes de ley y afiliaciones** | `Tipo_aporte_ley`, `Parametro_aporte_ley`, `Afiliacion_ley` | Dependen de Persona y de los conceptos |
| **8. Novedades y conceptos recurrentes** | `Novedad`, `Concepto_persona` | Alimentan el procesamiento del período |
| **9. Procesar período y generar recibos** | `Periodo_Nomina`, `Recibo_pago`, `Detalle_recibo` | Es la pieza más sensible; se hace con todo lo anterior estable |
| **10. Préstamos y cuotas** | `Prestamo`, `Cuota_prestamo` | Incremento sobre el recibo; al final del dominio |
| **11. Logs, validación y despliegue** | Bitácora de eventos, endurecer validaciones, entregar desplegado | Cierra lo que se defiende |

**Regla para decidir si una fase está "lista":** el flujo funciona de punta a
punta, sus validaciones están probadas (prueba manual o automatizada) y no
depende de algo que la fase siguiente todavía no va a tener.

## Frontend (otro repositorio)

Sin negocio propio: no calcula nómina ni decide permisos. Login, menú desde
la respuesta del servidor y componentes `ui-*`. Nunca arma SQL ni rutas por
entidad: usa `execute(subsystem, className, method, params)`. Todo texto de
usuario se escapa (`escapeHtml`) o se inserta con `textContent`. Ver skill
`nomina-frontend`.

## Flujo de trabajo (SDD)

No se programa sin spec. Comandos en `.opencode/commands/`:

| Comando | Qué hace |
|---|---|
| `/sdd-constitution [cambio]` | crea o enmienda `docs/constitution.md` |
| `/sdd-spec <feature>` | escribe `specs/<NNN-feature>/spec.md` |
| `/sdd-clarify <feature>` | resuelve las dudas del spec |
| `/sdd-plan <feature>` | plan técnico (`plan.md`) |
| `/sdd-tasks <feature>` | tareas verificables (`tasks.md`) |
| `/sdd-implement <feature> [T#]` | implementa una tarea a la vez |
| `/sdd-validate <feature>` | valida contra spec, constitución y skills |
| `/sdd-status [feature]` | estado de cada feature y siguiente paso |
| `/sdd-change <feature> <cambio>` | cambio de requisitos sobre un spec |

**Al terminar cada tarea (`T#`) se hace un commit**, con un mensaje que
describe qué tarea cierra. No se agrupan varias tareas en un commit ni se deja
trabajo sin commitear al pasar a la siguiente.

El commit es **parte de la tarea**: la tarea no está cerrada hasta que su
cambio está commiteado. **Regla obligatoria e innegociable:** en cuanto una
tarea queda verificada, se commitea **de inmediato**, antes de empezar la
siguiente. No se acumulan tareas para commitear al final ni se commitea una
tarea junto con otra. Si la tarea toca varios archivos, todos entran en el
mismo commit. `specs/` está en `.gitignore`: los artefactos de la spec no se
commitean; lo que se commitea es el código, el SQL y los tests de esa tarea.
No esperar a que el usuario lo pida: el commit hace parte del flujo.

## Memoria

Al empezar una sesión leer `MEMORY.md` (snapshot corto) y, si hace falta el
detalle, `docs/constitution.md`, `docs/bitacora.md` y este archivo. Las
decisiones nuevas se registran en este `AGENTS.md` (sección
"Aprendizajes y errores a evitar") y el avance en `MEMORY.md` y
`docs/bitacora.md`.

## Skills

Cargar según el tema (`.opencode/skills/`):

| Skill | Cuándo |
|---|---|
| `sdd` | ejecutar cualquier `/sdd-*` o tocar `specs/` |
| `nomina-seguridad` | `src/security/`, login, `/execute`, métodos u opciones nuevas, permisos |
| `nomina-dominio` | recibos, aportes de ley, bonos, préstamos, períodos, dinero |
| `nomina-frontend` | componentes, signals, menú, llamadas al servidor |
| `nomina-postgres-neon` | migraciones, tipos, consultas desde Node |
| `archify` | crear o **actualizar el diagrama de arquitectura** (ver sección siguiente) |
| `graphify` | consultar el **grafo de conocimiento** del repo (ver sección siguiente) |

Si algo contradice una skill, **la skill manda**: cada regla nació de una
decisión o de un error ya resuelto. Si crees que está mal, dilo en vez de
saltarla.

## Diagrama de arquitectura (obligatorio mantenerlo al día)

El repo versiona un diagrama de arquitectura interactivo generado con la skill
`archify`, dentro de su propia carpeta `archify-out/`:

```
archify-out/payroll-backend-architecture.json   fuente editable (spec de archify)
archify-out/payroll-backend-architecture.html   artefacto entregado (no editar a mano)
archify-out/payroll-backend-architecture.visual-check.*   evidencia de navegador
```

**Regla:** cada cambio **importante** debe refrescar el diagrama en el mismo
cambio (mismo commit que el código). Es "importante" todo lo que altere la
topología o el flujo:

- Mover, crear o borrar un objeto de negocio (`src/bo/...`), una clase o un
  subsistema.
- Cambiar el endpoint único `/execute`, el orden de `Security.executeMethod`
  o el esquema de seguridad (Subsistema/Clase/Metodo/Perfil).
- Cambiar el acceso a datos (componente `Database`, `queries.yaml`, la
  conexión a Neon) o el arranque (`src/index.js`, `src/app.js`).
- Agregar o quitar una dependencia estructural (sesión, CORS, store, etc.).

Cómo actualizarlo (la skill `archify` manda):

```bash
# 1. Editar archify-out/payroll-backend-architecture.json (no el HTML).
# 2. Validar con el perfil showcase: exige 9/9 checks, 0 errores, 0 warnings.
node <archify>/bin/archify.mjs validate architecture \
  archify-out/payroll-backend-architecture.json --quality showcase --json
# 3. Entregar (congela la spec y commitea el HTML).
node <archify>/bin/archify.mjs deliver architecture \
  archify-out/payroll-backend-architecture.json archify-out/payroll-backend-architecture.html \
  --quality showcase --json
# 4. Evidencia de navegador.
node <archify>/bin/archify.mjs visual-check \
  archify-out/payroll-backend-architecture.html --json
```

El diagrama muestra la arquitectura **real**: cliente → `POST /api/execute` →
`Security` (forma → permiso → reflexión) → objetos de negocio de
`src/bo/` (`Session/`, `Security/`) → componente de datos → PostgreSQL en Neon,
con los mapas de permisos en memoria y `queries.yaml`. Si el código y el
diagrama difieren, la tarea no está cerrada.

## Grafo de conocimiento (obligatorio mantenerlo al día)

Además del diagrama, el repo usa la skill `graphify` para construir un **grafo
de conocimiento** navegable del código: nodos (clases, métodos, tablas,
consultas, conceptos de los docs) y aristas (llamadas, herencia, imports,
`references`, `rationale_for`). Sirve para responder preguntas de arquitectura
y relaciones ("¿quién llama a `executeMethod`?", "¿cómo fluye el login?") sin
recorrer archivo por archivo.

```
graphify-out/graph.json     grafo (GraphRAG-ready)
graphify-out/graph.html     grafo interactivo (abrir en el navegador)
graphify-out/GRAPH_REPORT.md  reporte de auditoría (god nodes, preguntas)
graphify-out/manifest.json  hashes para el `--update` incremental
graphify-out/cost.json      tokens acumulados
```

**A diferencia del diagrama, `graphify-out/` NO se versiona** (está en
`.gitignore`): es un **artefacto derivado y voluminoso** que se regenera desde
el código. Versionarlo llenaría los diffs de un JSON generado y provocaría
merges imposibles. El diagrama de `archify` es la vista oficial y curada; el
grafo es la herramienta de consulta del agente.

**Regla:** el grafo debe refrescarse ante los **mismos cambios importantes**
que exigen actualizar el diagrama (topología, `/execute`, `Security`,
`Database`, `queries.yaml`, arranque, dependencias estructurales). El refresh
**no** va en el mismo commit (el grafo no se commitea), pero sí antes de la
siguiente sesión de consulta.

Cómo construirlo / refrescarlo (la skill `graphify` manda):

```bash
# Primera vez o reconstrucción total (repo solo-código: AST, sin API key).
/graphify .
# Tras cambios: re-extrae solo lo nuevo o modificado (incremental).
/graphify . --update
# Consultar (no reconstruye).
/graphify query "¿cómo fluye el login de punta a punta?"
```

Notas de este repo:

- El corpus real es **código + 3 docs** (`docs-publicas/despliegue.txt`,
  `src/queries/queries.yaml`, `pnpm-workspace.yaml`). El código lo extrae el
  AST (determinista, sin LLM ni API key); los docs, un subagente semántico.
- `.graphifyignore` (raíz) excluye los artefactos del diagrama de `archify`
  (`archify-out/`) y `scripts/manual/*` para que el grafo
  refleje el proyecto y no el ruido de las herramientas.
- Si el código y el grafo difieren, la consulta miente: refrescar con
  `--update` antes de responder preguntas.
