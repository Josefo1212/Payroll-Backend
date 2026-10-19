// T13: login correcto, clave mala suma intento, bloqueo y reinicio
import { security } from "../src/security/Security.js";
import { db } from "../src/database/Database.js";
import { authenticateUser } from "../src/services/authService.js";

const seed = async () => {
  // crear usuario con contraseña en texto plano para este test? mejor usar bcrypt directo
  // pero tenemos authService con bcrypt.compare; vamos a insertar con hash conocido
};

const p = {
  cedula: "T13-001",
  primer_nombre: "T13",
  primer_apellido: "T",
  username: "t13_001",
  password: "123456"
};

// registrar rápido
const res = await security.executeMethod({ subsystem: "Seguridad", class: "Usuario", method: "registrar", params: [p] }, { userID: 1, userName: "a", profiles: [2] });
console.log("reg:", res.status);
