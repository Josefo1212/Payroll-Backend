import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";

const directorio = dirname(fileURLToPath(import.meta.url));

// Las consultas viven en queries.yaml y se leen una sola vez al arrancar.
export const queries = parse(readFileSync(join(directorio, "queries.yaml"), "utf8"));
