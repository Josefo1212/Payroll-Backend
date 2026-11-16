# Auditoría de seguridad del backend

Fecha: 2026-11-16. Alcance: `src/` (HTTP, sesión, seguridad, BO de identidad),
`db/migrations/015_sesion.sql`, dependencias de producción y configuración de
entorno. No incluye el repositorio del front ni la infraestructura de Neon.

## Resumen

| Tema | Estado previo | Acción |
|---|---|---|
| Encriptación de datos sensibles | TLS a la BD, bcrypt y refresh tokens hasheados; PII y `cuenta_bancaria.nro_cuenta` en claro | Documentado como riesgo residual (decisión abajo) |
| Cookies de sesión | `httpOnly`, `SameSite=Lax`, `secure` en producción, `MemoryStore` | Sesión persistida en PostgreSQL (`sesion`), `no-store` global, borrado correcto de cookies |
| Hash de contraseñas | bcrypt costo 12, mínimo 8 con letra y número, tope 72 bytes | Sin cambios; se agregó límite de fallos por IP y no reutilizar la clave actual |
| Validación de entrada | UUID/enteros/enums en los BO; `registrar` confiaba en los `varchar` | `registrar` valida largos, formatos, fechas, enums y monto antes de la transacción |
| CORS | Lista de orígenes solo en CORS; CSRF leía otra variable | Una sola fuente (`src/config/http.js`); sin excepción para orígenes ajenos |
| CSRF / origen | Solo `logout` y `refresh`; exigía `Origin`/`Referer` | `verificarOrigen` global para métodos que cambian estado |
| Headers de seguridad | `helmet()` por defecto | Configuración explícita: CSP sin HTML, `frame-ancestors 'none'`, `no-referrer`, HSTS en producción |
| Manejo de errores | 404 HTML, 413/400 sin JSON, 500 genérico | 404/400/413 en JSON y 500 sin detalles |
| Dependencias | `body-parser 2.3.0` y `qs 6.16.0` con avisos | `pnpm audit --prod`: sin vulnerabilidades conocidas |

## Qué se cambió

### 1. Sesión en PostgreSQL

`express-session` usaba `MemoryStore`: las sesiones vivían en el proceso, se
perdían al reiniciar, no se podían invalidar desde otro nodo y el mapa crecía
sin límite. La migración `015_sesion.sql` agrega:

```sql
sesion (sid text PK, sess jsonb NOT NULL, expira_en timestamptz NOT NULL)
```

`src/database/SessionStore.js` implementa el contrato `session.Store`
(`get/set/destroy/touch`), renueva `expira_en` en cada petición y borra las
vencidas cada 15 minutos con un temporizador `unref`. La sesión guarda
`userID`, perfiles y banderas; **nunca** la contraseña ni su hash (verificado:
`sess ? 'password_hash'` = `false`).

### 2. Cookies y caché

- `connect.sid`: `httpOnly`, `SameSite=Lax`, `secure` en producción o con
  `COOKIE_SECURE=true`.
- `access_token` (15 min) y `refresh_token` (7 días): mismas banderas.
- `logout` y `cambiarClave` borran las cookies con
  `tokenService.opcionesBorradoCookie()`, sin `maxAge` (un `maxAge` positivo en
  `clearCookie` reescribe `expires` al futuro y deja la cookie viva con valor
  vacío).
- Toda respuesta lleva `Cache-Control: no-store` y `Pragma: no-cache`: son
  datos de sesión y de nómina, no deben quedar en caché.

### 3. Contraseñas

Sin cambios en el algoritmo (bcrypt costo 12). Se agregó:

- Límite por IP de intentos fallidos de login (`LOGIN_RATE_MAX`, 10 por
  defecto; `LOGIN_RATE_WINDOW_MINUTES`, 15 por defecto): cuenta solo 4xx
  (salvo 429), limpia al acierto, responde `429` con `Retry-After`. El bloqueo
  por cuenta (`usuario.bloqueado_hasta`) sigue siendo la defensa principal.
- `cambiarClave` rechaza reutilizar la clave actual (`400`) y revoca todos los
  refresh tokens del usuario, además de borrar las cookies de token: si la
  clave se cambió porque estaba comprometida, un token robado deja de servir.
- El login conserva el orden deliberado (cuenta inactiva/bloqueada antes de
  comparar la clave, contra un hash dummy para no filtrar tiempos).

### 4. Validación de entrada

`Security/User/registrar` valida antes de abrir la transacción y responde
`400` nombrando el campo, en vez de dejar que PostgreSQL devuelva `22001`
(que terminaba en `500`):

- `cedula` ≤ 20, nombres ≤ 60, `email` ≤ 120 con formato, `nro_tlf` ≤ 20,
  `direccion` ≤ 250.
- `username` ≤ 60 y solo `[A-Za-z0-9._-]`.
- `fecha_nacimiento`/`laboral.*` en `AAAA-MM-DD` y fecha real (rechaza
  `2026-02-31`).
- `sexo` y `estado_civil` dentro del enum de la BD.
- `laboral.monto > 0` y `horas_semanales` entre 0 y 168.

El body parser sigue limitado a `10kb`; un cuerpo mayor responde `413` en JSON.

### 5. CORS, origen y CSRF

`src/config/http.js` es la única fuente de orígenes (`FRONTEND_URLS` o
`FRONTEND_URL`, por defecto `http://localhost:5173`). CORS ya no lanza una
excepción para un origen ajeno (el navegador simplemente no recibe cabeceras);
`verificarOrigen` responde `403` en cualquier método que cambia estado
(`POST/PUT/PATCH/DELETE`) cuando el `Origin` o el `Referer` no están
permitidos. Sin `Origin` ni `Referer` se deja pasar: no hay navegador que haga
un POST cross-site sin `Origin`, y los scripts de verificación no lo mandan;
`SameSite=Lax` sigue siendo la segunda barrera.

### 6. Headers

`helmet` con configuración explícita:

- CSP `default-src 'none'; frame-ancestors 'none'; base-uri 'none';
  form-action 'none'` (el backend no sirve HTML).
- `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
  `Cross-Origin-Resource-Policy: same-site`.
- HSTS (`max-age=15552000`, `includeSubDomains`) solo en producción.
- `x-powered-by` desactivado.

### 7. Errores

- Ruta desconocida: `404 {"error":"Ruta no encontrada."}` (antes HTML de
  Express).
- JSON inválido: `400`; cuerpo grande: `413`; otro 4xx del parser: JSON.
- `ErrorNegocio` se traduce a su status; lo no controlado responde `500`
  genérico y se registra con `datosSegurosDeError` (sin filas ni
  credenciales).

### 8. Dependencias

`pnpm audit --prod` reportaba `body-parser 2.3.0` (DoS por bytes sobrantes tras
un cuerpo comprimido) y `qs 6.16.0` (TypeError en `stringify`), ambos
transitivos de `express`. Se fijaron `body-parser 2.4.0` y `qs 6.17.1` con
`overrides` en `pnpm-workspace.yaml`. Auditoría final: **sin
vulnerabilidades conocidas**.

## Riesgos residuales (conscientes)

1. **Sin cifrado de campo para PII ni número de cuenta.** `persona`
   (cédula, email, teléfono, dirección) y `cuenta_bancaria.nro_cuenta` se
   guardan en claro. Se evaluó cifrar a nivel de aplicación y se descartó:
   rompe los `UNIQUE` (cédula, email, `(banco_id, nro_cuenta)`), la
   idempotencia de los seeds y ninguna consulta de BO lee hoy el número de
   cuenta. La protección efectiva es TLS en tránsito (verificado por defecto),
   cifrado en reposo de Neon y acceso restringido a la base. Si se exige
   cifrado de campo, hay que decidir antes cómo se busca por cédula/email
   (hash determinista o índice ciego).
2. **`trust proxy` 1 + límite por IP.** Si el backend se expone directo a
   Internet, un atacante puede falsear `X-Forwarded-For` y rotar la IP del
   límite. El despliegue debe quedar detrás de un único proxy de confianza; el
   bloqueo por cuenta sigue protegiendo cada usuario.
3. **El límite de fallos es por proceso.** Con varias instancias, cada una
   lleva su contador. Hoy hay una sola instancia; si escala, mover el contador
   a PostgreSQL o a un almacén compartido.
4. **El login distingue cuenta inactiva (403) y bloqueada (423) de
   credenciales inválidas (401).** Permite enumerar usuarios con cuentas
   existentes. Se mantiene porque el front muestra mensajes distintos y las
   pruebas lo fijan; el límite por IP y el bloqueo por cuenta lo mitigan.
5. **`connect.sid` conserva el nombre por defecto.** Cambiarlo es oscuridad,
   no seguridad; no se hizo para no romper clientes ni pruebas.

## Verificación

- `pnpm test`: **228/228** (26 nuevas: rate limit, origen y validación de
  `registrar`).
- `pnpm audit --prod`: sin vulnerabilidades.
- Contra el servidor real (puerto 3002) y Neon de desarrollo:
  - `POST /api/login` con `Origin: http://evil.test` → `403`; con el origen
    permitido → `200` y cookies `HttpOnly; SameSite=Lax`.
  - `POST /api/execute` autenticado → `200`; con origen ajeno → `403`.
  - Ruta `/api/no-existe` → `404` JSON; JSON roto → `400`; cuerpo > 10kb →
    `413`.
  - `sesion`: la fila existe, `sess` no contiene `password_hash`, `touch`
    renueva `expira_en` y `logout` borra la fila y revoca los refresh tokens.
  - 10 fallos de login desde una IP (`X-Forwarded-For` de prueba) → el
    intento 11 responde `429` con `Retry-After`; otra IP sigue entrando.
  - `Payroll/PreNomina/ver` como RRHH → `200`; como Empleado → `403`.
- `scripts/manual/pre_nomina_e2e.mjs --yes` **no corre en el branch de
  desarrollo actual**: el seed de demo deja contratos vigentes sin fecha de
  fin, y el script aborta si encuentra más de un contrato en su período
  ("debe correr en un branch desechable"). No es una regresión de este cambio;
  el E2E sigue necesitando un branch limpio.
