# Bitácora — Sistema de Nómina

Registro histórico del proyecto, fase por fase. Es el detalle que antes vivía
en `MEMORY.md`; se separó para que `MEMORY.md` quede como estado, decisiones y
aprendizajes vigentes. No se borra: es el rastro de por qué cada cosa es como
es. Orden cronológico.

- **Fase 0 — base del servidor (2026-10-08)** — se crea la base del servidor:
  `package.json` (ESM), `src/index.js` y `src/app.js` con Express. Se
  establece la estructura de carpetas `src/{config,controllers,middleware,
  routes,services,queries}`.
- **Fase 0 — conexión a la base (2026-10-09)** — `src/config/database.js`
  con un `Pool` de `pg` sobre PostgreSQL (Neon) usando `DATABASE_URL`
  (`sslmode=require`) como única cadena de conexión; falla al arrancar si
  falta. `src/services/databaseService.js` expone `dbService.query` y
  `dbService.transaction`. Se cargan `db/init.sql` (esquema previo, 21
  tablas) y `db/seed-login.sql` (usuario de prueba `admin_prueba`).
- **Fase 0 — sesión (2026-10-11)** — `express-session` (cookie `httpOnly`),
  `src/middleware/requireAuth.js`, y el flujo de autenticación:
  `POST /api/login`, `GET /api/me` (protegido) y `POST /api/logout`, con
  `authController`, `authService` y las consultas en `src/queries/
  queries.json`. **Deuda**: la contraseña se compara en texto plano.
- **Fase 0 — refactor y CORS (2026-10-12)** — se reordena la estructura de
  carpetas y se configura `cors` **con credenciales** para permitir al
  cliente el envío de la cookie de sesión (`credentials: 'include'` en el
  front).
- **Documentación — esquemas visuales (2026-10-13)** — se versiona el
  diagrama de arquitectura del backend (`payroll-backend-architecture.html`
  y sus exportaciones `.png`/`.json`).
- **Documentación — modelo y reorganización (2026-10-14)** — se documenta el
  **modelo de datos v6 (26 tablas)** con el esquema de seguridad del profesor
  y se reorganiza la documentación al formato del proyecto de referencia:
  `AGENTS.md` (contexto y decisiones), `MEMORY.md` (snapshot),
  `docs/constitution.md` y `docs/bitacora.md`; desaparece `memory/`.
  **Nota**: `memory/` daba por escrita la migración
  `db/migrations/002_seguridad_profesor.sql`, pero la carpeta `db/migrations/`
  no existe en el repo — queda pendiente escribirla y correrla en un branch
  de Neon.
- **Fase 1 — migración y consultas (2026-10-14)** — la carpeta `db/migrations/`
  ya existe con `001_init.sql` (esquema previo movido desde `db/`) y
  `002_esquema_seguridad.sql`: crea `Subsistema`, `Opcion`, `Clase`, `Metodo`,
  `Usuario_Perfil`, `Permiso_Opcion` y `Permiso_Metodo`; migra
  `Usuario.Perfil_id` → `Usuario_Perfil` y borra el diseño viejo. Aplicada en
  Neon. Las consultas pasan de `src/queries/queries.json` a
  `src/queries/queries.yaml`, cargadas una sola vez al arrancar por
  `src/queries/loader.js` (dependencia `yaml`). El query de login se ajustó al
  esquema nuevo (`JOIN Usuario_Perfil`, un perfil activo por usuario) y se
  agrega `db/seed-superusuario.sql`, que crea el perfil **Superusuario**, lo
  asigna a `admin_prueba` y quita el vínculo al perfil temporal
  `PRUEBA_LOGIN` (sin permisos todavía). El seed de seguridad queda en pausa.
- **Fase 2 — seguridad, sesión y registro (2026-10-19)** — `Security.js` con
  `loadPermission()`, `PermissionMethodMap` / `PermissionOptionMap` y
  `executeMethod` (forma → permiso → reflexión → ejecución); `registrar` en
  `src/bo/UserBO.js` (Persona + Usuario en una transacción, bcrypt); login con
  `bcrypt.compare`, bloqueo por intentos (`423`) y sesión con `profiles`;
  seed de seguridad aplicado. Se corrigieron tres deudas: la clave de
  `admin_prueba` pasó a bcrypt, `Bloqueado_hasta`/`Ultimo_acceso` a
  `TIMESTAMPTZ` (`003_zona_horaria_seguridad.sql`) y `seed-login.sql` al
  esquema sin `Usuario.Perfil_id`. Spec 002 pasa a **implementada** (T1–T14).
- **Fase 3 — endpoint único `POST /execute` (2026-10-19)** —
  `src/controllers/executeController.js` y `src/routes/executeRoutes.js`:
  el endpoint exige sesión (`401`), delega en `Security.executeMethod` y
  propaga `400`/`403`/`501`/`409`; un error no controlado da `500`. El
  controlador no lleva SQL ni reglas de negocio. Se fija la cookie de sesión
  con `httpOnly` y `sameSite: "lax"`. Verificado por HTTP con
  `tools/t003_execute.mjs`. Spec 003 **implementada**.
- **Esquema consolidado v8 (2026-10-20)** — el esquema completo queda en un
  solo `db/init.sql` (27 tablas, snake_case, **sin número**) que se corre
  **una vez** sobre una base vacía, espejado 1:1 con `db/schema.dbml`. Las
  migraciones `001..006` se consolidaron dentro del init; los cambios
  posteriores sobre una base con datos vuelven a `db/migrations/NNN_*.sql`
  (**número primero**). `uuid` en las tablas transaccionales y
  `persona`/`usuario`/`refresh_token`; `serial` en las maestras. Se agrega
  `refresh_token` (JWT con rotación por `familia_id`) como **adicional** a
  `express-session`, no como reemplazo. `scripts/db-setup.sh` se reescribe
  para aplicar `init.sql` + seeds (con `--with-test-user`).
  **Aplicado en Neon** en un branch nuevo (borrón y cuenta nueva sobre base
  vacía): 27 tablas, 18 enums, login real que devuelve `userID` UUID,
  sesión, menú por permisos y logout verificados; `pnpm test` en 62/62 (el
  código es agnóstico al tipo: los UUID viajan como texto).
- **Seeds de seguridad reescritos (2026-10-20)** — se eliminan
  `seed-login.sql` y `seed-superusuario.sql`. `db/seed-seguridad.sql` siembra
  los cinco perfiles (`Publico`, `Empleado`, `GerenteRRHH`, `Administrador`,
  `Superusuario`), subsistemas, clases, métodos, opciones y sus permisos;
  `db/seed-usuario-prueba.sql` crea `admin_prueba` (`Password123`, bcrypt) y
  lo liga a los cuatro perfiles no públicos para probar la lógica OR de
  permisos. Validado en Postgres local (login real devuelve los 4 perfiles);
  **no ejecutado en Neon**.

- **Spec 004 (JWT) en implementación (2026-10-21)** — access token en cookie
  `httpOnly` (`access_token`) firmado con `jose` (HS256, ESM, cero deps),
  refresh token opaco guardado como SHA-256 (nunca en claro) con rotación por
  familia (`familia_id`) y revocación total ante reuso. `TokenService`
  (`src/services/`), BO `Token` con `refresh` (`src/bo/Session/`), ruta propia
  `POST /api/refresh` y guard del access token en `Security.executeMethod`
  (hidrata la sesión desde la cookie si no hay `connect.sid`, sin alterar el
  orden forma → sesión → permiso → reflexión). `Session.login` emite ambas
  cookies y `logout` revoca las familias del usuario. La clase `Token`/método
  `refresh` vive en `db/seed-seguridad.sql` con permiso `Publico` (más
  Empleado/GerenteRRHH/Administrador y Superusuario por subsistema).
  Verificado: login/refresh/reuso (familia revocada) con datos desechables y
  `pnpm test` 62/62 (fixture de usuario actualizado a UUID).

## Pendiente (en orden)

1. Fase 1 (resto) — `db/schema.dbml` (el seed de seguridad ya está aplicado).
2. Fase 4 — primer BO de punta a punta (`Persona`).
3. Fase 5 — endpoint de opciones/menú desde `PermissionOptionMap` y front:
   login, menú y componentes.
4. Fases 6–10 — contratos y salarios, aportes de ley, novedades y conceptos,
   procesar período y recibos, préstamos y cuotas.
5. Fase 11 — logs, validación y despliegue.
6. Correr los seeds nuevos en Neon (`./scripts/db-setup.sh --with-test-user`).

## 2026-10-25 — Spec 005 y 006

- **Spec 005 (perfiles / público)**: Se eliminó el uso genérico del perfil "Público". `Security/Menu/getOptions` se mantiene en `POST /api/execute` con excepción explícita para llamadas anónimas (sin agregar perfil Público). Se reinició la tabla `perfil` con IDs desde 1: `Superusuario(1)`, `Administrador(2)`, `GerenteRRHH(3)`, `Empleado(4)` sin `Público`. Se agregó `Security/User/listarPerfiles` (solo Superusuario/Administrador/GerenteRRHH) para desacoplar la lista de perfiles del formulario de registro. Se quitaron consultas/validaciones relacionadas con `Público` en seguridad e `index.js`. Tests ajustados.
- **Spec 006 (registro completo)**: Se extendió `Security/User/registrar` para aceptar bloque opcional `laboral` (`cargo_id`, `fecha_inicio`, `tipo_pago`, `frecuencia_pago`, `monto`, opcionales `horas_semanales`, `fecha_fin`, `vigente_desde`, `vigente_hasta`, `motivo`). En la misma transacción se crea `contrato` (`VIGENTE`) y `contrato_salario`. Retrocompatible cuando no se envía `laboral`. Se agregaron queries `insertContrato`, `insertContratoSalario`, `findCargoById`.
- **Pruebas**: `pnpm test` 62/62 OK tras ajustes.

## 2026-10-26 — Spec 007

- **Listar cargos**: `Security/User/listarCargos` expuesto vía `/execute` con permiso para Superusuario y RRHH. Carga desde `cargo` activos ordenados por nombre.
- **Permisos registro**: `Security/User/registrar` solo para Superusuario y RRHH (se quitó a Administrador).
- **Migración 002**: Crea método `listarCargos`, asigna permisos y siembra cargos.
- **Verificación**: Login OK, `listarCargos` retorna 4 cargos, registro con `laboral` crea contrato y contrato_salario.

## 2026-11-08 - Subsistema Payroll (nomina)

- Se implemento el primer dominio de negocio completo: subsistema `Payroll`
  con 8 clases (`Cargo`, `Hours`, `Affiliation`, `Concept`, `Novedad`,
  `Loan`, `Period`, `Receipt`) descubiertas dinamicamente por carpeta.
- `PayrollCalculator` (`decimal.js`): 240 horas/mes, recargo de hora extra
  x1.5, prorrateo por frecuencia (MENSUAL completo, QUINCENAL /2, SEMANAL
  x12/52), aportes de ley con vigencia y cuotas de prestamo con interes
  simple plano (la ultima cuota absorbe el redondeo).
- `db/migrations/004_payroll.sql`: tabla `registro_horas`, columna
  `cargo.valor_hora_base`, 12 conceptos base, tipos y parametros de aporte
  de ley (SSO 4/9%, paro 0.5/2%, FAOV 1/2%, INCES 0/2%), 8 clases, 33
  metodos, permisos (RRHH/GerenteRRHH/Administrador/Superusuario y lectura
  propia para Empleado) y opciones de menu. Idempotente.
- `src/bo/Payroll/queries.yaml` con 64 consultas; `loader.js` las expone.
- Verificado sin BD: `node --check` de los 9 archivos, import de los 8 BO,
  descubrimiento en `Security` (8 clases Payroll, `_scope.js` omitido por
  el regex) y prueba de calculos (12000/240=50.00, extra 75.00, quincenal
  6000.00, semanal 2769.23, prestamo 10000@10%/4=2750.00).
- Pendiente: aplicar 004 en un branch de Neon (fallo de autenticacion al
  intentar el dry-run), prueba curl del flujo completo y refrescar
  diagrama `archify` y grafo `graphify`.

### Cierre de alcance local (2026-11-08)

- Se agrego `Security/User/listarPersonas` (query `findAllPersonas`) para que
  RRHH obtenga el `persona_id`; migracion idempotente
  `db/migrations/005_listar_personas.sql` con permisos para
  RRHH/GerenteRRHH/Administrador/Superusuario.
- Se corrigio el orden de `scripts/db-setup.sh`: `db/seed-seguridad.sql` va
  antes de las migraciones, porque 001-005 asignan permisos a perfiles que
  crea el seed.
- Pruebas automatizadas del calculador en
  `test/payrollCalculator.test.js` (240 h, recargo x1.5, prorrateo, cuotas
  con redondeo). `pnpm test` 69/69.
- Verificacion E2E por HTTP en `scripts/manual/payroll_e2e.mjs`: alta con
  contrato, afiliaciones, bono, horas, prestamo, periodo, procesar, pagar,
  recibos propios del empleado y 403 al intentar procesar. Limpia sus datos.
- `PENDIENTE-SOCIO.txt` con los pasos para habilitar el branch de Neon
  (credencial actual invalida: `password authentication failed`).

### Aplicacion de 004 y 005 en Neon (2026-11-08)

- La credencial de `.env` volvio a autenticar. Estado inicial verificado: 27
  tablas base, `cargo` con 4 filas (002 aplicada), pero sin `registro_horas`,
  sin subsistema `Payroll`, sin conceptos ni aportes de ley: faltaban 004 y
  005.
- Antes de migrar se guardo un respaldo del esquema en
  `/tmp/opencode/payroll-backup-<fecha>.sql` (fuera del repo).
- La primera corrida de 004 fallo al insertar `parametro_aporte_ley`: los
  `NULL` de un `VALUES` sin tipo se resuelven como `text` y no encajan en
  `decimal(12,2)`. Como la migracion va en `BEGIN/COMMIT`, revirtio completa;
  se corrigio con casts explicitos (`::numeric(12,2)`) y se reejecuto.
- Resultado: 004 y 005 aplicadas en orden, ambas idempotentes al reejecutar
  (0 filas insertadas). Verificado: 8 clases y 33 metodos de Payroll, 12
  conceptos, 4 tipos de aporte, 103 permisos de metodo, 8 opciones de menu y
  `Security/User/listarPersonas` con permisos.
- Verificacion: `pnpm test` 69/69; `node scripts/manual/payroll_e2e.mjs --yes`
  50/50 comprobaciones y `PAYROLL E2E OK` (asignaciones 575.00, deducciones
  86.63, neto 488.37; el empleado ve su recibo y recibe 403 al procesar).
- Diagrama `archify` refrescado con el subsistema Payroll (9/9 checks
  showcase, 0 errores, 0 warnings, visual-check sin overflow).

### Administración de permisos de método por perfil (2026-11-08)

- Spec 009: `Security/Admin` suma `listarMetodos`, `listarPermisosMetodo`,
  `asignarPermisoMetodo` y `quitarPermisoMetodo`. La migración idempotente
  `db/migrations/006_permisos_metodos.sql` siembra los cuatro métodos, los
  concede solo a `Superusuario` y crea la opción de menú `Permisos`
  (`Security`, orden 4), exclusiva de ese perfil (borra el grant que el seed
  da a `Administrador`).
- Seis consultas nuevas en `src/bo/Security/queries.yaml`. El BO valida los
  ids (`400`), exige perfil/método activos (`404`), escribe primero en
  `permiso_metodo` y después actualiza `PermissionMethodMap` con
  `security.setPermissionMethod`, sin reiniciar. Asignar y quitar son
  idempotentes (`yaEstaba` / `yaNoEstaba`).
- Guarda anti-bloqueo: quitar a `Superusuario` cualquiera de los cinco
  métodos que sostienen la vista responde `409` sin tocar base ni mapa.
- Verificación: `pnpm test` **80/80** (11 casos nuevos en
  `test/adminPermisos.test.js`) y `node scripts/manual/permisos_e2e.mjs
  --yes` **38/38 → PERMISOS E2E OK**, restaurando el estado inicial.
- Diagrama `archify` refrescado (mención de la edición en caliente y de la
  guarda anti-bloqueo); grafo `graphify` regenerado.

### Opciones de menú de Security completadas (2026-11-08)

- La base viva tenía `registrar`, `Usuarios` y `Perfiles` (subsistema
  `Security`) sin ningún `permiso_opcion`: el seed no se había aplicado
  completo. Migración idempotente `db/migrations/007_opciones_security.sql`.
- Los grants se alinearon con los métodos que cada perfil puede ejecutar
  (la 003 le quitó `registrar` a `Administrador`, así que no se le muestra
  esa opción): `registrar` → Superusuario/RRHH; `Usuarios` →
  Superusuario/Administrador/RRHH; `Perfiles` → Superusuario/Administrador.
  `Permisos` sigue exclusiva de Superusuario (006).
- Incluye un `DELETE` defensivo para que reejecutar el seed no vuelva a
  conceder opciones que el perfil no puede usar. Verificado: 30
  `permiso_opcion` (22 de Payroll + 8 de Security), segunda corrida 0 filas.

### Administración de perfiles y asignación a usuarios (2026-11-08)

- Spec 010: `Security/Admin` suma `listarPerfilesAdmin` (Superusuario y
  Administrador), `crearPerfil`, `editarPerfil` y `cambiarEstadoPerfil` (solo
  Superusuario); `Security/User` suma `establecerPerfilesUsuario` (solo
  Superusuario), que reemplaza el conjunto completo en una transacción
  (`DELETE` + `INSERT`), y `listarPerfilesUsuario` (Superusuario y
  Administrador), que lee el conjunto actual para pintarlo antes de
  reemplazarlo. Las migraciones idempotentes `008_perfiles.sql` y
  `009_listar_perfiles_usuario.sql` siembran los seis métodos, conceden sus
  permisos y corrigen la descripción de la opción `Perfiles` a
  "Gestión de perfiles". No hay cambio de esquema.
- Un perfil nuevo nace con 6 permisos base de sesión
  (`Session/Session/{logout,getSession,sessionExist}`, `Session/Token/refresh`,
  `Security/Menu/getOptions`, `Security/User/cambiarClave`) insertados en la
  misma transacción. `crearPerfil` y `cambiarEstadoPerfil` recargan
  `PermissionMethodMap`; `editarPerfil` no, porque las llaves usan `perfil_id`.
- Guarda de escalada: un solicitante sin `Superusuario` no puede asignar
  `Superusuario`, `Administrador` ni `GerenteRRHH` (`403`), ni en `registrar`
  ni en `establecerPerfilesUsuario`; un id inexistente/inactivo sigue dando
  `400` antes que `403`. Guarda anti-bloqueo: `Superusuario` no se renombra ni
  se desactiva, y no se puede quitar al último usuario activo que lo tiene
  (`409`).
- Verificación: `pnpm test` **102/102** (los casos de
  `test/adminPerfiles.test.js`, la guarda en `test/usuario.test.js` y la
  lectura del conjunto actual) y
  `node scripts/manual/perfiles_e2e.mjs --yes` **43/43 → PERFILES E2E OK**,
  restaurando los perfiles de `admin_prueba` y borrando el perfil temporal.
- Límite conocido: la unicidad del nombre sin distinguir mayúsculas se valida
  en el BO (`LOWER()`); la BD no tiene índice único funcional, así que dos
  creaciones concurrentes de `Contador`/`contador` podrían pasar. Se
  documenta sin cambiar el esquema.

### Administración de opciones de menú por perfil (2026-11-09)

- Spec 011: `Security/Admin` suma el catálogo `listarSubsistemas`,
  `listarOpciones`, `crearOpcion`, `editarOpcion` y `cambiarEstadoOpcion`, y
  la asignación perfil ↔ opción
  `listarPermisosOpcion`, `asignarPermisoOpcion` y `quitarPermisoOpcion`,
  todos solo para `Superusuario`. Es la segunda interfaz de administración que
  necesita el front; la de métodos ya existía desde la spec 009.
- La migración idempotente `db/migrations/010_opciones_perfil.sql` siembra los
  siete métodos del catálogo y la asignación, concede sus permisos solo a
  `Superusuario` y crea la opción de menú `Opciones` (Security, orden 5),
  exclusiva de ese perfil. La `011_listar_subsistemas.sql` agrega
  `listarSubsistemas` (el formulario de creación necesita el id de cualquier
  subsistema, incluso de uno sin opciones). Sin cambio de esquema.
- `listarOpciones` devuelve activas e inactivas con `subsistemaId` (lo que
  necesita `crearOpcion`), `perfiles` (solo perfiles activos que la ven) y
  `protegida`. `editarOpcion` y `cambiarEstadoOpcion` recargan
  `PermissionOptionMap`; desactivar no borra `permiso_opcion`, así que
  reactivar restaura el acceso. Renombrar cambia la llave del mapa.
- Guardas: `OPCIONES_CRITICAS = {Security/Opciones, Security/Permisos,
  Security/Perfiles, Security/Usuarios}` no se pueden quitar, renombrar ni
  desactivar en `Superusuario` (`409`); `METODOS_CRITICOS` suma los siete
  métodos nuevos. Nombre de opción: 2–80 alfanuméricos empezando por letra,
  sin `_`; único por subsistema con `LOWER()`; `orden` entero 0–32767.
- `crearPerfil` acepta un tercer parámetro opcional `perfilPlantillaId` y
  clona `permiso_metodo` y `permiso_opcion` de la plantilla en la misma
  transacción, después de los 6 permisos base. Sin plantilla, el contrato es
  idéntico a la spec 010.
- Verificación: `pnpm test` **133/133** (31 casos en
  `test/adminOpciones.test.js`) y `node scripts/manual/opciones_e2e.mjs
  --yes` **62/62 → OPCIONES E2E OK**, comprobando el menú en caliente y
  restaurando los perfiles de `admin_prueba` y borrando los temporales.
- El E2E real destapó un `GROUP BY` incompleto en `findAllOptionsAdmin`
  (`s.id` faltaba) que la base falsa no podía ver: PostgreSQL respondía
  `42803`. Corregido y documentado en `AGENTS.md`.

### Horas extras (2026-11-10)

- `Payroll/Hours` suma `registrarExtra`, `listarExtrasPorPeriodo` y
  `quitarExtra`, exclusivos de `Superusuario`. No hay cambio de esquema: la
  extra se guarda en `registro_horas.horas_extra` (migración 004) y el
  `UNIQUE (persona_id, fecha)` obliga a un upsert que **suma** sobre la fila
  del día; si RRHH ya registró horas normales, se conservan.
- `quitarExtra` pone `horas_extra = 0` cuando el día tiene horas normales y
  solo elimina la fila cuando tenía únicamente extras. Reutilizar
  `Hours.eliminar` habría borrado también las normales.
- `db/migrations/012_horas_extras.sql` es solo de datos e idempotente:
  siembra los tres métodos, sus `permiso_metodo` y la opción de menú
  `HorasExtras` (Payroll, orden 9), todo solo para `Superusuario`. La opción
  actual `Horas` (RRHH y Superusuario) se mantiene sin cambios.
- Front: `OvertimePage` en `/payroll/horas-extras`, `HoursService` suma
  `registrarExtra`, `listarExtrasPorPeriodo` y `quitarExtra`, y el menú mapea
  `HorasExtras`. El `RoleRoute allow={['superuser']}` deja pasar también a
  `Administrador`; por eso la página valida por nombre de perfil
  (`hasProfile(user, 'Superusuario')`). El backend sigue validando el permiso
  real.
- Verificación: `pnpm test` **145/145** (12 casos nuevos en
  `test/horasExtras.test.js`) y `node scripts/manual/horas_extras_e2e.mjs
  --yes` **42/42 → HORAS EXTRAS E2E OK**. El E2E comprueba el upsert, el
  listado por período, que RRHH recibe `403` en los tres métodos, que la
  pantalla `Horas` de RRHH sigue funcionando, que quitar conserva las horas
  normales y que la opción es invisible para RRHH.
- La migración 012 se aplicó sobre el branch de desarrollo de Neon (no había
  `neonctl` ni API key en el entorno); es aditiva e idempotente.

### Menú por perfil activo y horas extras para RRHH (2026-11-10)

- **Bug del sidebar.** El front filtraba el menú por **rol**
  (`menuStore.fetchMenu(role)`) y para `rrhh` dejaba pasar `Payroll` y
  `Security`, mientras que `superuser` lo dejaba pasar todo. Como
  `Superusuario`/`Administrador` comparten `superuser` y `RRHH`/`GerenteRRHH`
  comparten `rrhh`, al cambiar de perfil seguía apareciendo `Seguridad` aunque
  el perfil activo no tuviera esas opciones.
- **Fix backend.** `Security/Menu/getOptions(perfilId)` valida que el perfil
  pertenezca a `req.session.profiles` (`403` si no) y devuelve solo sus
  opciones; un `perfilId` no entero responde `400` y sin sesión devuelve `[]`.
  Sin argumento conserva la unión de perfiles (compatibilidad y menú anónimo).
  Cuatro casos nuevos en `test/menu.test.js`.
- **Fix front.** `SecurityService.getMenuOptions(perfilId)`,
  `menuStore.fetchMenu(perfilId, force?)` con caché por perfil (invalidada
  entera al forzar), `SidebarNav` recibe `perfilId` desde
  `user.activeProfile.id`, y `OptionsPage` refresca con el perfil activo. Se
  eliminó el filtro por rol. El fallback de carga ya no inyecta `Seguridad`:
  solo dibuja el bloque común "Mi espacio" mientras llega la primera
  respuesta.
- **Horas extras para RRHH.** `db/migrations/013_horas_extras_rrhh.sql`
  concede `registrarExtra`, `listarExtrasPorPeriodo`, `quitarExtra` y la opción
  `HorasExtras` a `RRHH`/`GerenteRRHH`. Aplicada y verificada en Neon:
  `HorasExtras` → RRHH y Superusuario; los tres métodos → RRHH y Superusuario.
  `AppRouter` permite `/payroll/horas-extras` a `['superuser','rrhh']` y
  `OvertimePage` valida por nombre (`Superusuario`, `RRHH`, `GerenteRRHH`);
  `Administrador` sigue viendo la tarjeta de acceso restringido.
- **Verificación.** `pnpm test` **149/149** y
  `node scripts/manual/menu_perfil_e2e.mjs` **30/30 → MENU PERFIL E2E OK**
  (script de solo lectura que pide el menú de cada perfil de `admin_prueba`).
  Prueba real con `admin_prueba`
  (todos los perfiles) contra `POST /api/execute`:
  Superusuario `[1]` → Nómina + Seguridad completa + `HorasExtras`;
  Administrador `[2]` → Nómina + `Usuarios`/`Perfiles`, sin `HorasExtras`;
  RRHH `[3]` → Nómina + `HorasExtras` + `Registrar personas`/`Usuarios`;
  Empleado `[4]` → solo `MisRecibos`; perfil ajeno `99` → `403`. Verificado
  también en el navegador cambiando de perfil en el sidebar. Front:
  `pnpm typecheck` y `pnpm build` OK.
- **Nota de orden.** La 012 revierte `HorasExtras` a los perfiles distintos de
  Superusuario; la 013 debe correr después. Volver a ejecutar la 012 sobre una
  base con la 013 quitaría el acceso a RRHH y habría que reaplicar la 013.

## Pre-nómina: borrador editable de la nómina (2026-11-15)

Spec 012. La pre-nómina es un **borrador por período** que RRHH genera, ve,
edita, guarda, elimina y confirma para producir la nómina final.

- **Esquema.** `db/migrations/014_pre_nomina.sql` crea `pre_nomina`
  (`UNIQUE (periodo_nomina_id)`), `pre_nomina_recibo` y `pre_nomina_detalle`,
  más el enum `origen_linea` (`CALCULADA`, `RECURRENTE`, `NOVEDAD`, `PRESTAMO`,
  `LEY`, `MANUAL`). Todo cuelga con `ON DELETE CASCADE`: borrar el período (o
  el borrador) no deja huérfanos. No hay columna de estado: el borrador existe
  o no existe. `db/init.sql` no se toca; `db/schema.dbml` pasa a v10 (31
  tablas). La migración se validó sobre un PostgreSQL 16 en Docker con la
  cadena completa 001–013 + 014 (dos veces, idempotente) antes de aplicarla en
  el branch de desarrollo de Neon; no se pudo crear un branch de respaldo
  porque no hay `neonctl` ni `NEON_API_KEY` en la máquina, así que se tomó un
  respaldo solo de esquema.
- **Clase y permisos.** La 014 siembra la clase `Payroll/PreNomina` con
  `generar`, `ver`, `guardar`, `eliminar` y `confirmar`, y la opción de menú
  `PreNomina` (Payroll, orden 10). Solo `RRHH` y `Superusuario`;
  `Administrador` queda fuera y `Empleado` no la ve. El front valida por
  nombre de perfil porque `Administrador` comparte el rol `superuser`.
- **`PayrollWriter`.** `src/bo/Payroll/PayrollWriter.js` extrae de
  `Period.procesar` la construcción de líneas, el recálculo de `LEY` y
  `APORTE_PATRONAL` con la tasa congelada, los totales y la escritura del
  recibo. `Period.procesar` y `PreNomina.confirmar` lo comparten: un solo
  cálculo para el borrador y para el recibo final. No está sembrado en
  `metodo` y no es invocable por `/execute`.
- **Edición.** Solo las líneas `CALCULADA` y `MANUAL` son editables; el
  backend devuelve `editable` y el front no lo adivina. `guardar` recibe
  `(preNominaId, version, { recibos })`, reemplaza las líneas editables de
  cada recibo enviado (las omitidas se borran, las `id: null` se insertan como
  `MANUAL`) y sube `version`. Se valida todo antes de aplicar nada; una versión
  vieja responde `409`. Si el recálculo de ley da 0, la línea se borra (el
  CHECK exige `monto > 0`).
- **Confirmar.** En una transacción: bloquea período y borrador (siempre en
  ese orden), revalida `BORRADOR` y `version`, exige que no haya novedades
  aprobadas ni cuotas vencidas **fuera** del borrador, escribe el recibo
  final, marca por id las novedades (`APLICADA`) y las cuotas (`DESCONTADA`),
  deja el préstamo `PAGADO` si no le quedan cuotas y borra el borrador.
  Un `23505` de cuota repetida se traduce a `409`.
- **Período.** `Period.procesar` responde `409` si hay una pre-nómina sin
  confirmar; `Period.listar` expone `preNominaId`/`preNominaVersion` y
  `Period.ver` agrega `preNomina: { id, version } | null`.
- **Verificación.** `pnpm test` **202/202** (40 en `test/preNomina.test.js`,
  13 de regresión en `test/payrollWriter.test.js`) y
  `node scripts/manual/pre_nomina_e2e.mjs --yes` **143/143 →
  `PRE NOMINA E2E OK`** contra el branch de desarrollo: empleado semanal con
  contrato por hora, afiliaciones, descuento recurrente, horas, préstamo y
  novedad aprobada → `generar` (sin efectos secundarios) → `ver` →
  `eliminar`/`generar` (idempotente) → `guardar` (sueldo 500, bono manual 25,
  extra calculada fuera; neto 570,00 − 161,35 = 408,65 y patronal 74,10) →
  `confirmar` → `pagar` → el empleado ve su recibo. El E2E deja la base como
  la encontró.
- **Diagrama.** `archify-out/payroll-backend-architecture.json` suma el nodo
  `PayrollWriter`, `pre_nomina*` en el nodo de Neon y la vista "Pre-nómina";
  `validate --quality showcase` 9/9 con 0 errores y 0 warnings, `deliver` OK y
  `visual-check` pasa en 1440×900, 1600×1000, 1920×1080 y 2048×1320 (antes
  desbordaba en tres de esos tamaños por las tarjetas; se recortaron a 2–3
  ítems).
- **Front pendiente.** La pantalla `/payroll/pre-nomina` vive en el otro repo;
  el contrato queda en `PROMPT-FRONT.md`.

## 2026-11-16 — Auditoría de seguridad del backend

Se revisaron cookies de sesión, hash de contraseñas, validación de entrada,
CORS, headers, manejo de errores y cifrado de datos sensibles.

- **Sesión.** `express-session` deja `MemoryStore`: migración
  `015_sesion.sql` (`sesion(sid, sess jsonb, expira_en)` + índice) y
  `src/database/SessionStore.js` con `get/set/destroy/touch`, TTL de 24 h,
  `touch` en cada petición y barrido de vencidas cada 15 min. La sesión no
  guarda contraseñas ni hashes.
- **Cookies.** `httpOnly`, `SameSite=Lax`, `secure` en producción o con
  `COOKIE_SECURE`; `logout` y `cambiarClave` las borran sin `maxAge` (con
  `maxAge`, `clearCookie` deja la cookie viva). Toda respuesta lleva
  `Cache-Control: no-store`.
- **Login.** Se suma un límite por IP de intentos fallidos
  (`LOGIN_RATE_MAX`/`LOGIN_RATE_WINDOW_MINUTES`, 10 en 15 min): cuenta solo
  4xx salvo 429, limpia al acierto y responde `429` con `Retry-After`. El
  bloqueo por cuenta y el orden deliberado de `Session.login` no cambian.
- **Contraseñas.** Sin cambios en bcrypt (costo 12). `cambiarClave` rechaza
  reutilizar la clave actual y revoca todos los refresh tokens del usuario;
  las cookies de token se borran.
- **Validación.** `Security/User/registrar` valida largos (cédula ≤ 20,
  nombres ≤ 60, email ≤ 120, teléfono ≤ 20, dirección ≤ 250, username ≤ 60),
  formatos (email, `[A-Za-z0-9._-]`, fechas `AAAA-MM-DD` reales), enums
  (`sexo`, `estado_civil`), `monto > 0` y `horas_semanales` 0–168. Un dato
  inválido responde `400` nombrando el campo en vez de `500` por `22001`.
- **CORS y origen.** `src/config/http.js` es la única fuente de orígenes
  (`FRONTEND_URLS`/`FRONTEND_URL`). CORS ya no lanza excepción para un origen
  ajeno y `verificarOrigen` responde `403` en todo método que cambia estado
  (login, logout, refresh, `/execute`). Sin `Origin`/`Referer` se deja pasar
  (curl y E2E); `SameSite=Lax` sigue siendo la segunda barrera.
- **Headers.** `helmet` explícito: CSP `default-src 'none'`,
  `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'none'`,
  `Referrer-Policy: no-referrer`, `nosniff`, CORP `same-site`, HSTS solo en
  producción y `x-powered-by` apagado.
- **Errores.** 404 JSON para rutas desconocidas, 400 para JSON roto, 413 para
  cuerpo > 10kb, 500 genérico sin detalles y log con `datosSegurosDeError`.
- **Dependencias.** `pnpm audit --prod` reportaba `body-parser 2.3.0` (DoS) y
  `qs 6.16.0` (TypeError), transitivos de `express`. Se fijaron
  `body-parser 2.4.0` y `qs 6.17.1` en `pnpm-workspace.yaml` (pnpm 12 ya no lee
  `pnpm.overrides` de `package.json`). Auditoría final limpia.
- **Cifrado de datos sensibles.** TLS a la BD (verificado por defecto),
  bcrypt y refresh tokens hasheados. Se evaluó cifrar PII y `nro_cuenta` a
  nivel de aplicación y se descartó: rompe los `UNIQUE`, la idempotencia de
  los seeds y ningún BO lee el número de cuenta. Queda documentado como
  riesgo residual en `docs/auditoria-seguridad.md`.
- **Verificación.** `pnpm test` **228/228** (26 nuevas: rate limit, origen y
  validación de `registrar`) y `pnpm audit --prod` limpio. Contra el servidor
  real: login con origen ajeno `403`, con origen permitido `200`; `/execute`
  autenticado `200` y con origen ajeno `403`; `/api/no-existe` `404` JSON;
  JSON roto `400`; cuerpo grande `413`; la fila de `sesion` existe sin
  `password_hash`, `touch` renueva `expira_en` y `logout` la borra y revoca
  los tokens; 10 fallos desde una IP → `429` con `Retry-After` y otra IP sigue
  entrando; `Payroll/PreNomina/ver` RRHH `200` y Empleado `403`.
- **E2E.** `pre_nomina_e2e.mjs` aborta en el branch de desarrollo con el seed
  de demo porque hay varios contratos vigentes sin fecha de fin en su período;
  el script exige un branch desechable. No es una regresión de este cambio.
- **Diagrama.** `archify` refrescado con el store de sesiones, el chequeo de
  origen y los headers; `validate --quality showcase` 9/9, `deliver` y
  `visual-check` en los cuatro tamaños.

## 2026-11-16 — Topes de texto y datos mínimos expuestos

- **Textos libres con tope.** `src/services/TextoService.js` centraliza
  `requerido`/`opcional` (recorte con `trim`, máximo por campo) y responde
  `400` nombrando el campo y el máximo. Se aplica a `Hours.registrar` y
  `registrarExtra` (`observacion` 200), `Novedad.registrar` (`observacion`
  200), `Concept.asignarRecurrente` (`observacion` 200), `Period.crear`
  (`descripcion` 200) y `Period.pagar` (`referencia_pago` 60),
  `Affiliation.registrar` (`nro_afiliacion` 30) y `User.registrar`
  (`laboral.motivo` 150). `Security/User` reutiliza el mismo servicio en vez
  de mantener una copia.
- **Selector de personas más angosto.** `Security/User/listarPersonas`
  devolvía `email` y `monto_salario`; ninguna pantalla los usaba (los
  selectores muestran nombres, cédula y cargo; la tabla de usuarios usa
  `username`, `usuario_activo` y el contrato). Se quitaron de la consulta y
  del tipo `PersonaItem`. Verificado contra Neon: la consulta corre y no
  trae esas columnas.
- **Front con `maxLength`.** `src/constants/inputLimits.ts` replica los
  `varchar` de la BD; se aplicó en registro, login, registro público, perfil,
  ajustes, solicitudes (incluido el textarea de revisión), departamentos,
  conceptos, novedades, horas, extras, afiliaciones, períodos y pre-nómina
  (`inputMode="decimal"` en monto/cantidad). `PasswordInput` ahora reenvía
  `maxLength`.
- **Verificación.** `pnpm test` **235/235** (7 nuevas en
  `test/texto.test.js`) y `tsc --noEmit` limpio en el front.

## 2026-11-19 — Resumen de nómina (spec 013)

- **Dos métodos de solo lectura en `Payroll/Period`.** `resumen(periodoId)`
  devuelve los totales del período (personas, asignaciones, deducciones,
  neto, aporte patronal y costo total) y el desglose por concepto;
  `listarConTotales()` devuelve el histórico con los mismos totales. No hay
  tabla de totales: se suman `recibo_pago` y `detalle_recibo` al vuelo.
- **El aporte patronal no es columna de `recibo_pago`.** Se suma desde
  `detalle_recibo` (`tipo_concepto = 'APORTE_PATRONAL'`) y se reporta aparte;
  `costo_total = asignaciones + aporte_patronal`, nunca dentro del neto.
- **Migración `016_resumen_nomina.sql`** (solo datos): siembra `resumen` y
  `listarConTotales` y los concede a `RRHH`, `GerenteRRHH`, `Administrador` y
  `Superusuario`. Sin opción de menú nueva: el resumen se ve dentro de la
  pantalla de períodos.
- **Verificación.** `pnpm test` **250/250** (4 nuevas en
  `test/resumenNomina.test.js`) y `scripts/manual/resumen_e2e.mjs` **17/17 →
  RESUMEN E2E OK** contra el período procesado más reciente de Neon (compara
  con la suma directa en SQL y con el desglose por concepto). Sin cambio de
  esquema ni de topología, por lo que no se refresca `archify`.

## 2026-11-19 — PDF del recibo (spec 014)

- **El PDF se arma en el servidor con `pdfkit`.** `Payroll/Receipt` suma
  `generarPdf(reciboId)`; `src/services/ReciboPdfService.js` compone el
  documento (encabezado, período, líneas, neto y pie) y el BO devuelve
  `{ nombreArchivo, mimeType, tamanioBytes, contenidoBase64 }`. El front lo
  descarga desde el base64; no hay ruta de archivos aparte.
- **La pertenencia se valida en el BO.** El permiso `generarPdf` se concede a
  `RRHH`, `GerenteRRHH`, `Administrador`, `Superusuario` y `Empleado`; los
  gestores (`esGestorNomina`) ven cualquier recibo y el empleado solo el suyo
  (`403` si no coincide `persona_id`). El mapa de permisos es por perfil, no
  por fila.
- **Migración `017_pdf_recibo.sql`** (solo datos): siembra el método y sus
  permisos. Sin cambio de esquema ni de topología.
- **Verificación.** `pnpm test` **256/256** (6 nuevas en
  `test/reciboPdf.test.js`) y `scripts/manual/pdf_recibo_e2e.mjs` **20/20 →
  PDF RECIBO E2E OK** (empleado propio, ajeno `403`, RRHH y Superusuario,
  recibo inexistente y sin sesión).

## 2026-11-19 — Registro de personas y despidos (spec 015)

- **Nuevo BO `Payroll/Employee`.** `listar(estado)`, `ver(personaId)`,
  `despedir(personaId, motivo, fecha, descripcion)`, `listarDespidos()` y
  `listarMotivos()`. El motivo se lee del enum `motivo_despido` con
  `pg_enum`, no está escrito a mano en el front.
- **El despido es transaccional.** Orden fijo persona → contrato; después
  inserta `despido`, finaliza el contrato, inactiva la persona, desactiva el
  usuario, revoca sus refresh tokens y borra sus sesiones
  (`sess->>'userID'`). `UNIQUE (contrato_id)` impide un segundo despido
  (`409`).
- **La nómina incluye al despedido del período.** `findContratosVigentesPorFrecuencia`
  acepta `FINALIZADO` con `fecha_fin BETWEEN inicio AND fin` y dejó de exigir
  `persona.estado = 'ACTIVO'`. `sueldoPeriodoProporcional` paga solo los días
  trabajados del contrato dentro del período.
- **Migración `018_despidos.sql`**: enum `motivo_despido`, tabla `despido`,
  clase `Employee`, cinco métodos y opciones `Personas` (11) y `Despidos`
  (12), solo para `RRHH` y `Superusuario`. `db/schema.dbml` v12 (33 tablas).
- **Verificación.** `pnpm test` **271/271** (11 nuevas en
  `test/employee.test.js` y 4 del prorrateo) y
  `scripts/manual/despidos_e2e.mjs` **45/45 → DESPIDOS E2E OK**: alta de una
  persona de prueba, despido, verificación en BD, inclusión en la nómina,
  prorrateo, `403` de Empleado y Administrador, y limpieza total en
  `finally`. Diagrama `archify` refrescado (9/9 checks, visual-check OK).
