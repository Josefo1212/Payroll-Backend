import bcrypt from "bcrypt";

// Imprime el hash bcrypt (cost 12) de la contraseña pasada como argumento.
// Uso: node scripts/hash-password.js "Password123"
const clave = process.argv[2];

if (!clave) {
  console.error("Uso: node scripts/hash-password.js <contraseña>");
  process.exit(1);
}

const hash = await bcrypt.hash(clave, 12);
console.log(hash);
