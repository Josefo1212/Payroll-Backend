// Guarda de los scripts manuales. Se importa al principio de cada script:
// avisa que va a escribir en la BD apuntada por DATABASE_URL y aborta salvo
// que se pasen las condiciones. Evita correrlos por accidente.
import "dotenv/config";

const url = process.env.DATABASE_URL;

if (process.env.NODE_ENV === "production") {
  console.error("ABORTADO: NODE_ENV=production. Estos scripts no corren en producción.");
  process.exit(1);
}

if (!process.argv.includes("--yes")) {
  console.error(
    "Este script escribe en la BD de DATABASE_URL" +
      (url ? ` (${url.replace(/:[^:@/]*@/, ":***@")})` : "") +
      ".\n" +
      "Volvé a ejecutarlo con --yes para confirmar.",
  );
  process.exit(1);
}

console.warn(
  "Este script escribe en la BD de DATABASE_URL" +
    (url ? ` (${url.replace(/:[^:@/]*@/, ":***@")})` : "") +
    ".",
);
