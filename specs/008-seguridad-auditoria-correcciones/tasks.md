# Tasks 008 — Correcciones de Auditoría de Seguridad

Spec: `specs/008-seguridad-auditoria-correcciones/spec.md`  
Plan: `specs/008-seguridad-auditoria-correcciones/plan.md`

## Tareas

### T001 — Corregir bug crítico en Token.js
**Prioridad:** CRÍTICA  
**Archivo:** `src/bo/Session/Token.js`  
**Descripción:** Corregir uso de `sessionQueries` no importado. Cambiar a `queries.findProfilesByUserId`.  
**Criterio aceptación:** Sin errores de referencia, refresh funciona correctamente.  
**Verificación:** `node --check src/bo/Session/Token.js` y prueba manual refresh.

### T002 — Añadir headers de seguridad con helmet
**Prioridad:** ALTA  
**Archivos:** `src/app.js`, `package.json`  
**Descripción:** Instalar y configurar `helmet()`. Asegurar que no rompe CORS ni cookies.  
**Criterio aceptación:** Headers `X-Content-Type-Options`, `X-Frame-Options` presentes.  
**Verificación:** Inspeccionar respuesta HTTP.

### T003 — Configurar límites de body y trust proxy
**Prioridad:** ALTA  
**Archivo:** `src/app.js`  
**Descripción:** `express.json({ limit: '10kb' })`. Añadir `app.set('trust proxy', 1)` si necesario (comentado o condicional).  
**Criterio aceptación:** Body >10kb rechazado apropiadamente.  
**Verificación:** Prueba con body grande.

### T004 — Crear middlewares de seguridad
**Prioridad:** ALTA  
**Archivos:** `src/middlewares/csrf.js`, `src/middlewares/requireCambioClave.js`  
**Descripción:** Crear middlewares reutilizables.  
**Criterio aceptación:** Archivos creados con exports correctos.  
**Verificación:** `node --check` de cada archivo.

### T005 — Implementar protección CSRF
**Prioridad:** ALTA  
**Archivos:** `src/routes/authRoutes.js`, `src/middlewares/csrf.js`  
**Descripción:** Verificar Origin/Referer para `/api/refresh` y `/api/logout`. Permitir mismo origen.  
**Criterio aceptación:** Petición cross-origin rechazada con 403.  
**Verificación:** Petición desde origen distinto.

### T006 — Restricción por debe_cambiar_clave
**Prioridad:** ALTA  
**Archivos:** `src/security/Security.js`, `src/middlewares/requireCambioClave.js`  
**Descripción:** Si `req.session.debeCambiarClave` true, solo permitir `Session/Session/logout` y `Security/User/cambiarClave`. Otros métodos retornan 403.  
**Criterio aceptación:** Usuario con bandera no puede ejecutar otros métodos.  
**Verificación:** Prueba con usuario que tenga debe_cambiar_clave.

### T007 — Endurecer TokenService
**Prioridad:** ALTA  
**Archivo:** `src/services/TokenService.js`  
**Descripción:** Verificar algoritmo fijo, validar iss, asegurar secretos en prod. Añadir validación de longitud mínima de JWT_SECRET.  
**Criterio aceptación:** Rechaza tokens con algoritmo incorrecto.  
**Verificación:** Pruebas de validación.

### T008 — Mejorar seguridad refresh token
**Prioridad:** ALTA  
**Archivo:** `src/bo/Session/Token.js`  
**Descripción:** Añadir `SELECT ... FOR UPDATE` en transacción, validar usuario activo, asegurar revocación completa de familia.  
**Criterio aceptación:** Reutilización revoca familia completa. Concurrencia manejada.  
**Verificación:** Pruebas manuales.

### T009 — Añadir Cache-Control a /me
**Prioridad:** MEDIA  
**Archivo:** `src/routes/authRoutes.js`  
**Descripción:** `res.set('Cache-Control', 'no-store, no-cache, must-revalidate')` en GET /me.  
**Criterio aceptación:** Header presente.  
**Verificación:** Inspeccionar respuesta.

### T010 — Traducción de errores PG
**Prioridad:** MEDIA  
**Archivos:** `src/errors/pgErrors.js` (nuevo), BOs afectados  
**Descripción:** Traducir 23503, 23514, 22P02, 23001 a mensajes claros.  
**Criterio aceptación:** Errores traducidos correctamente.  
**Verificación:** Provocar errores controlados.

### T011 — Hardening CORS
**Prioridad:** MEDIA  
**Archivo:** `src/app.js`  
**Descripción:** Usar whitelist estricta desde env. Rechazar orígenes no permitidos.  
**Criterio aceptación:** Origen no permitido bloqueado.  
**Verificación:** Petición desde origen inválido.

### T012 — Auditoría IDOR por BO
**Prioridad:** ALTA  
**Archivos:** Todos los BOs en `src/bo/`  
**Descripción:** Revisar cada método para validar propiedad/recurso. Documentar hallazgos.  
**Criterio aceptación:** Checklist completado con evidencia.  
**Verificación:** Revisión código.

### T013 — Verificación y pruebas
**Prioridad:** CRÍTICA  
**Descripción:** Ejecutar `pnpm test`, pruebas manuales de login/logout/refresh, verificar cookies, headers.  
**Criterio aceptación:** 62/62 tests pasan. Funcionalidad core intacta.  
**Verificación:** `pnpm test` y pruebas manuales.

## Notas

- Todos los cambios deben mantener compatibilidad
- No romper flujo híbrido sesión+JWT
- No crear endpoint cambio de perfil
- Mantener tokens en cookies httpOnly
- Ejecutar tests tras cada cambio crítico
