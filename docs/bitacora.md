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
