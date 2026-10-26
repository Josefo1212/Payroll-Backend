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

**Hecho:** el esquema del profesor está consolidado en `db/init.sql`
(UUID en tablas transaccionales y `persona`/`usuario`/`refresh_token`;
`serial` en las maestras; tabla `refresh_token` para JWT con rotación),
probado end-to-end en un Postgres local (27 tablas, 18 enums, login real
con UUID). Las consultas viven en `queries.yaml`; el seed de seguridad está
aplicado (`db/seed-seguridad.sql`); `src/security/Security.js` (mapas y
`executeMethod`) y los BO de `src/bo/Session/` (`Session.js`) y `src/bo/Security/` (`Menu.js`, `Admin.js`, `User.js`) existen; el login usa
`bcrypt` con bloqueo por intentos y la sesión guarda los perfiles N:M.
`db/schema.dbml` (v8, 27 tablas) está escrito, en snake_case minúscula, y
espeja `db/init.sql` 1:1 (mismas tablas y columnas).
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
**Pendiente:** el endpoint del menú y el front (Fase 5), y migrar las
consultas de `queries.yaml` a los BO.

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
db/schema.dbml               modelo completo para dbdiagram.io (espeja init.sql)
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
(un solo archivo en snake_case minúscula) y espejado 1:1 en `db/schema.dbml`.
Las tablas transaccionales y `persona`/`usuario`/`refresh_token` usan `uuid`;
las maestras (`perfil`, `subsistema`, `opcion`, `clase`, `metodo`, `concepto`,
`banco`, `cargo`, `tipo_aporte_ley`, `parametro_aporte_ley`) usan `serial`.

| Grupo | Tablas |
|---|---|
| Seguridad: identidad | usuario, perfil, usuario_perfil, refresh_token |
| Seguridad: estructura | subsistema, opcion, clase, metodo |
| Seguridad: permisos | permiso_opcion, permiso_metodo |
| Personal | persona, cuenta_bancaria, banco, cargo, contrato, contrato_salario |
| Ley y seguro social | tipo_aporte_ley, parametro_aporte_ley, afiliacion_ley |
| Nómina | concepto, concepto_persona, novedad, periodo_nomina, recibo_pago, detalle_recibo |
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

## Decisiones de diseño

Registro de decisiones con su motivo. Las viejas no se editan: si una cambia,
se agrega una nueva que la reemplaza.

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
