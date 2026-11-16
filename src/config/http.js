import "dotenv/config";

const ORIGEN_POR_DEFECTO = "http://localhost:5173";

// Una sola fuente de verdad para CORS y para la verificación de origen de las
// peticiones que cambian estado. Antes cada middleware leía su propia
// variable: FRONTEND_URLS en CORS y FRONTEND_URL en CSRF, así que configurar
// una y no la otra dejaba el front bloqueado por un lado y abierto por el otro.
export const origenesPermitidos = Object.freeze(
  (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || ORIGEN_POR_DEFECTO)
    .split(",")
    .map((origen) => origen.trim().replace(/\/+$/, ""))
    .filter(Boolean),
);

// Sin Origin no hay CSRF posible (curl, scripts de verificación, clientes
// servidor-a-servidor). El navegador siempre manda Origin en un POST
// cross-site, y SameSite=Lax impide además que la cookie viaje.
export const esOrigenPermitido = (origen) => {
  if (!origen) {
    return true;
  }

  try {
    return origenesPermitidos.includes(new URL(origen).origin);
  } catch {
    // "null" (file://) u orígenes malformados: no son de confianza.
    return false;
  }
};

// COOKIE_SECURE permite forzar el flag en un entorno que no es producción
// (por ejemplo un túnel HTTPS) y desactivarlo en un despliegue de prueba.
export const cookieSegura = () => {
  const forzado = process.env.COOKIE_SECURE;
  if (forzado === "true") {
    return true;
  }
  if (forzado === "false") {
    return false;
  }
  return process.env.NODE_ENV === "production";
};
