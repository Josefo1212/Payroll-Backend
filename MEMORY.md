# MEMORY.md — Sistema de Nómina

Memoria del proyecto entre sesiones. Es un **snapshot corto** (≈50 líneas).
Las reglas permanentes viven en otro lado (ver abajo), no acá. Al convertirse
algo en regla permanente, se mueve a su documento y se quita de este archivo.

## Estado actual

- Node.js + Express + `pg` sobre PostgreSQL (Neon). Monolito, un solo punto
  de entrada al negocio (`POST /execute`, aún no construido).
- **Fase 0 (Bootstrap + Sesión) hecha**: `src/index.js`, `src/app.js`,
  `src/config/database.js` (Pool), `src/database/Database.js`
  (`query`/`transaction`), `POST /api/login`, `GET /api/me` (protegido) y
  `POST /api/logout`. CORS con credenciales y cookie de sesión `httpOnly`.
- `db/init.sql` es el **esquema base** (v8, 27 tablas, snake_case, **sin
  número**): se corre una vez sobre una base vacía. Los cambios posteriores
  van en `db/migrations/NNN_nombre.sql` (número primero). `uuid` en
  transaccionales y `persona`/`usuario`/`refresh_token`; `serial` en las
  maestras; tabla `refresh_token` para JWT con rotación (adicional a
  `express-session`). `db/schema.dbml` lo espeja 1:1.
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

- **Terminar la spec 004 (JWT)** — T6 (ruta `/refresh` y guard),
  T7 (config/docs) y T8 (verificación de punta a punta).
- **Fase 5** — endpoint de opciones/menú desde `PermissionOptionMap`, front y
  migrar `queries.yaml` a los BO.
- Conectar `getPermissionOption`/`setPermissionOption` (API del profesor, hoy
  sin consumidor).

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
