import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";

const ALGORITMO = "HS256";
const EMISOR = "nomina-backend";
const BYTES_REFRESH = 32;

const esProduccion = process.env.NODE_ENV === "production";

if (esProduccion && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET es obligatoria en producción.");
}

const jwtSecret = process.env.JWT_SECRET || "secreto_jwt_solo_desarrollo";

if (esProduccion && jwtSecret.length < 32) {
  throw new Error("JWT_SECRET debe tener al menos 32 caracteres en producción.");
}

const secreto = new TextEncoder().encode(jwtSecret);

const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL || "15m";
const REFRESH_TTL_DIAS = Number(process.env.REFRESH_TOKEN_TTL_DIAS || 7);

const bytesDe = (valor) => new TextEncoder().encode(valor);

class TokenService {
  firmarAccess = ({ userID, userName, perfiles }) =>
    new SignJWT({ userName, perfiles })
      .setProtectedHeader({ alg: ALGORITMO })
      .setSubject(userID)
      .setIssuer(EMISOR)
      .setIssuedAt()
      .setExpirationTime(ACCESS_TTL)
      .sign(secreto);

  verificarAccess = async (token) => {
    try {
      const { payload } = await jwtVerify(token, secreto, {
        issuer: EMISOR,
        algorithms: [ALGORITMO],
      });
      return payload;
    } catch {
      return null;
    }
  };

  generarRefresh = () => {
    const valor = randomBytes(BYTES_REFRESH).toString("base64url");
    return { valor, hash: this.hashRefresh(valor) };
  };

  hashRefresh = (valor) =>
    createHash("sha256").update(bytesDe(valor)).digest("hex");

  expiracionRefresh = () => {
    const ms = REFRESH_TTL_DIAS * 24 * 60 * 60 * 1000;
    return new Date(Date.now() + ms);
  };

  opcionesCookie = ({ refresh = false } = {}) => ({
    httpOnly: true,
    sameSite: "lax",
    secure: esProduccion,
    maxAge: refresh
      ? REFRESH_TTL_DIAS * 24 * 60 * 60 * 1000
      : 1000 * 60 * 15,
    path: "/",
  });
}

export { TokenService };
export const tokenService = new TokenService();
