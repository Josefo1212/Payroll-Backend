# MEMORY.md — Sistema de Nómina

Memoria del proyecto entre sesiones. Es un **snapshot corto** (≈50 líneas).
Las reglas permanentes viven en otro lado (ver abajo), no acá. Al convertirse
algo en regla permanente, se mueve a su documento y se quita de este archivo.

## Estado actual

- Node.js + Express + `pg` sobre PostgreSQL (Neon). Monolito, un solo punto
  de entrada al negocio (`POST /api/execute` → `Security.executeMethod`).
- **Fase 0 (Bootstrap + Sesión) hecha**: `src/index.js`, `src/app.js`,
  `src/config/database.js` (Pool), `src/database/Database.js`
  (`query`/`transaction`), `POST /api/login`, `GET /api/me` (protegido) y
  `POST /api/logout`. CORS con credenciales y cookie de sesión `httpOnly`.
- `db/init.sql` es el **esquema base** (v8, 27 tablas, snake_case, **sin
  número**): se corre una vez sobre una base vacía. Los cambios posteriores
  van en `db/migrations/NNN_nombre.sql` (número primero). `uuid` en
  transaccionales y `persona`/`usuario`/`refresh_token`; `serial` en las
  maestras; tabla `refresh_token` para JWT con rotación (adicional a
  `express-session`). `db/schema.dbml` refleja `init.sql` + migraciones.
- `db/seed-seguridad.sql` siembra subsistemas/clases/métodos, los perfiles
  (`Publico`, `Empleado`, `GerenteRRHH`, `Administrador`, `Superusuario`) y
  sus permisos; `db/seed-usuario-prueba.sql` crea `admin_prueba`
  (`Password123`, bcrypt) ligado a los cuatro perfiles para probar permisos.
- Validado end-to-end en Neon: 27 tablas, 18 enums, login real que devuelve
  `userID` UUID, sesión, menú por permisos y logout.
- El login usa `bcrypt.compare` con bloqueo por intentos; `Security.js`
  resuelve permisos en memoria y despacha por reflexión; los BO viven en
  `src/bo/Session/` (`Session.js`) y `src/bo/Security/` (`Menu.js`, `Admin.js`,
  `User.js`); `User` registra Persona + Usuario.
- **Spec 002 implementada y verificada** (T1–T14): T11/T12/T13 corren con
  `node tools/t11r.mjs`, `t12.mjs` y `t13f.mjs`.
- **Spec 003 implementada y verificada**: `POST /execute` (protegido) delega
  en `Security.executeMethod`; se prueba con `node tools/t003_execute.mjs`.
- **La sesión está separada de la seguridad**: subsistema `Session` (clase
  `Session`) y subsistema `Security` (clases `Menu`, `Admin`, `User`). La
  llave del mapa es `Session_Session_<metodo>_<perfilId>` para la sesión.
- **Servicios**: `src/services/PasswordService.js`,
  `src/services/PermissionKeyService.js` y `src/services/TokenService.js`
  (JWT con `jose`: firma/verifica access HS256, genera/hashea refresh).
- **Comentarios quitados de `src/**`**; `pnpm test` 62/62.
- **Spec 004 (JWT) en implementación**: access token en cookie `httpOnly`
  (`access_token`), refresh rotativo por familia (`refresh_token`), ruta
  propia `POST /api/refresh`, guard del access en `Security.executeMethod`,
  `Session.login` emite tokens y `logout` revoca la familia. Clase `Token`
  (método `refresh`) sembrada en `db/seed-seguridad.sql` con permiso
  `Publico`. T1–T5 hechas; faltan T6–T8.

## Próximo

- **Front (Fase 5)** — las dos pantallas de administración (perfil ↔ método y
  perfil ↔ opción) contra los métodos de `Security/Admin`, y el endpoint de
  opciones/menú desde `PermissionOptionMap`.
- Migrar `queries.yaml` a los BO.

## Pendientes menores

- Migrar `src/queries/queries.yaml` a consultas dentro de los BO.
- Aplicar `db/init.sql` en Neon: **borrón y cuenta nueva en un branch nuevo**
  (backup de `main` intacto), luego actualizar `DATABASE_URL` en `.env`.

## Dónde vive cada cosa

| Tema | Documento |
|---|---|
| Arquitectura, stack, convenciones, decisiones y aprendizajes | `AGENTS.md` |
| Constitución SDD | `docs/constitution.md` |
| Specs / planes / tareas | `specs/NNN-*/` |
| Historia fase por fase | `docs/bitacora.md` |
| Seguridad, login, `/execute` y permisos | skill `nomina-seguridad` |
| Cálculo de nómina, ley, préstamos y dinero | skill `nomina-dominio` |
| Migraciones, tipos y consultas desde Node | skill `nomina-postgres-neon` |
| Componentes, signals, menú y fetch | skill `nomina-frontend` |

- **Spec 005 (perfiles)**: Eliminado perfil "Público" genérico. `Menu/getOptions` sigue en `/execute` con excepción anónima explícita. `perfil` reiniciado con IDs 1-4 (Superusuario, Administrador, GerenteRRHH, Empleado). Añadido `Security/User/listarPerfiles` para desacoplar formulario de registro.
- **Spec 006 (registro completo)**: `Security/User/registrar` ahora acepta bloque opcional `laboral` y crea `contrato` + `contrato_salario` en misma transacción (retrocompatible).
- **Tests**: 62/62 OK.

- **Spec 007 (listar cargos)**: Añadido `Security/User/listarCargos`. Permisos para listar cargos y registrar solo Superusuario y RRHH (Administrador sin permiso para registrar). Cargos sembrados (Gerente de RRHH, Contador, Analista de Nómina, Asistente Administrativo). Registro con bloque `laboral` crea contrato/contrato_salario.

- **Subsistema `Payroll` implementado (2026-11-08)**: 8 BO en `src/bo/Payroll/` (`Cargo`, `Hours`, `Affiliation`, `Concept`, `Novedad`, `Loan`, `Period`, `Receipt`), `PayrollCalculator` con `decimal.js` (240 h/mes, extra ×1.5, prorrateo por frecuencia, cuotas con interés simple plano), `queries.yaml` (64 consultas), `db/migrations/004_payroll.sql` (registro_horas, `cargo.valor_hora_base`, 12 conceptos, aportes de ley, 8 clases, 33 métodos, permisos y menú) y `005_listar_personas.sql` (`Security/User/listarPersonas`). Tests del calculador: **69/69**.
- **004 y 005 aplicadas en Neon (2026-11-08)** sobre el branch de desarrollo: `registro_horas`, 12 conceptos, 4 tipos y 4 parámetros de aporte, subsistema Payroll (8 clases, 33 métodos), 103 permisos de método y 8 opciones de menú; `Security/User/listarPersonas` con permisos. Se corrigió un cast en 004 (`tope_base`/`piso_base` NULL de `VALUES` → `numeric(12,2)`). Re-ejecutadas: idempotentes (0 filas). `pnpm test` **69/69** y `payroll_e2e.mjs` **50/50 → PAYROLL E2E OK**. Diagrama `archify` refrescado con Payroll; falta refrescar el grafo `graphify`.
- **Spec 009 (permisos de método por perfil) implementada (2026-11-08)**: `Security/Admin` suma `listarMetodos`, `listarPermisosMetodo`, `asignarPermisoMetodo` y `quitarPermisoMetodo` (solo `Superusuario`); migración `006_permisos_metodos.sql` con la opción de menú `Permisos` exclusiva de `Superusuario`. La escritura va a `permiso_metodo` y luego al mapa con `security.setPermissionMethod` (en caliente, sin reiniciar); guarda anti-bloqueo 409 para los cinco métodos críticos. `pnpm test` **80/80** y `permisos_e2e.mjs` **38/38 → PERMISOS E2E OK**. Diagrama `archify` y grafo `graphify` refrescados.
- **Opciones de Security completadas (2026-11-08)**: migración `007_opciones_security.sql`; la base viva tenía `registrar`/`Usuarios`/`Perfiles` sin grants. Quedaron `registrar` → Superusuario/RRHH, `Usuarios` → Superusuario/Administrador/RRHH, `Perfiles` → Superusuario/Administrador, `Permisos` → Superusuario.
- **Spec 010 (administración de perfiles) implementada (2026-11-08)**: `Security/Admin` suma `listarPerfilesAdmin` (Superusuario y Administrador), `crearPerfil`, `editarPerfil` y `cambiarEstadoPerfil` (solo Superusuario); `Security/User` suma `establecerPerfilesUsuario` (solo Superusuario), que reemplaza el conjunto de perfiles en una transacción, y `listarPerfilesUsuario` (Superusuario y Administrador) para leer el conjunto actual. Migraciones `008_perfiles.sql` y `009_listar_perfiles_usuario.sql` (6 métodos + permisos, sin cambio de esquema). Perfil nuevo con 6 permisos base de sesión. Guardas: escalada de privilegios (`403`) y anti-bloqueo de `Superusuario` (`409`). `pnpm test` **102/102** y `perfiles_e2e.mjs` **43/43 → PERFILES E2E OK**. Diagrama `archify` y grafo `graphify` refrescados.
- **Spec 011 (administración de opciones de menú) implementada (2026-11-09)**: `Security/Admin` suma `listarSubsistemas`, `listarOpciones`, `crearOpcion`, `editarOpcion`, `cambiarEstadoOpcion`, `listarPermisosOpcion`, `asignarPermisoOpcion` y `quitarPermisoOpcion` (solo Superusuario); migraciones `010_opciones_perfil.sql` (7 métodos, permisos y opción `Opciones`) y `011_listar_subsistemas.sql`. `listarOpciones` trae `subsistemaId`, `perfiles` y `protegida`; las mutaciones recargan el mapa en caliente. `crearPerfil` acepta `perfilPlantillaId` y clona métodos y opciones de la plantilla. Guardas `OPCIONES_CRITICAS` y `METODOS_CRITICOS` (`409`). `pnpm test` **133/133** y `opciones_e2e.mjs` **62/62 → OPCIONES E2E OK**. Diagrama `archify` y grafo `graphify` refrescados.
- **Pendiente de la 010**: administrar `permiso_opcion` (qué opciones ve un perfil) quedó fuera de alcance; lo cubre la spec 011.
- **Horas extras implementadas (2026-11-10)**: `Payroll/Hours` suma `registrarExtra` (upsert que suma sobre `registro_horas.horas_extra` del día), `listarExtrasPorPeriodo` (solo filas con `horas_extra > 0`) y `quitarExtra` (pone la extra en 0 y solo borra la fila si no hay horas normales). Migración `012_horas_extras.sql` (solo datos, idempotente): tres métodos, permisos y opción `HorasExtras` (Payroll, orden 9) para `Superusuario`; la `013_horas_extras_rrhh.sql` los extiende a `RRHH`/`GerenteRRHH`. La pantalla `Horas` de RRHH no cambia. Front: `OvertimePage` en `/payroll/horas-extras`, con guard por nombre de perfil. `pnpm test` **149/149** y `horas_extras_e2e.mjs` **45/45 → HORAS EXTRAS E2E OK**.
- **Menú por perfil activo (2026-11-10)**: `Security/Menu/getOptions(perfilId)` valida que el perfil pertenezca a la sesión (`403` si no) y devuelve solo sus opciones; sin argumento mantiene la unión de perfiles. El front (`menuStore`, `SidebarNav`) pide el menú con `user.activeProfile.id`, cachea por perfil y dejó de filtrar por rol: `Superusuario`/`Administrador` comparten `superuser` y `RRHH`/`GerenteRRHH` comparten `rrhh`. Verificado en navegador con `admin_prueba`: Empleado solo ve `MisRecibos`; RRHH ve Nómina + `HorasExtras` y en Seguridad solo `Registrar personas` y `Usuarios`; Administrador no ve `HorasExtras`; Superusuario ve todo.
- **Spec 012 (pre-nómina) implementada (2026-11-15)**: `Payroll/PreNomina` con `generar`, `ver`, `guardar`, `eliminar` y `confirmar`; migración `014_pre_nomina.sql` (tablas `pre_nomina`, `pre_nomina_recibo`, `pre_nomina_detalle` + enum `origen_linea`), `db/schema.dbml` v10 (31 tablas), permisos y opción `PreNomina` solo para `RRHH`/`Superusuario`. `PayrollWriter` (`src/bo/Payroll/PayrollWriter.js`) comparte cálculo y escritura con `Period.procesar`, que ahora responde `409` si hay borrador. Un borrador por período; se borra al confirmar. `pnpm test` **202/202** y `pre_nomina_e2e.mjs` **143/143 → PRE NOMINA E2E OK**. Diagrama `archify` refrescado (validate 9/9, visual-check OK en 1440×900/1600×1000/1920×1080/2048×1320).
- **Datos de prueba para el front (2026-11-15)**: `db/seed-datos-prueba.sql` (idempotente, solo desarrollo) siembra 12 personas con contrato (SALARIO_FIJO y POR_HORA; semanal, quincenal y mensual), cuentas bancarias, afiliaciones de ley, conceptos recurrentes, horas normales y extras, 8 novedades (APROBADA/PENDIENTE/RECHAZADA), 4 préstamos (uno SOLICITADO) y 13 períodos; crea cuatro usuarios con clave `Password123` (`luis_gomez`, `pedro_hernandez`, `carmen_diaz` como `Empleado`; `rosa_vargas` como `Empleado` + `RRHH`). `scripts/manual/demo_periodos.mjs --yes` usa los BO reales para dejar "Semana 1 de octubre" PAGADO, las quincenas sep-oct y "Septiembre 2026" PROCESADO, y la pre-nómina de "Quincena 1 de noviembre 2026" en borrador. `pnpm test` 202/202.
