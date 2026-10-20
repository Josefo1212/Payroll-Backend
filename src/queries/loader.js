import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";

const directorio = dirname(fileURLToPath(import.meta.url));

export const queries = parse(readFileSync(join(directorio, "queries.yaml"), "utf8"));
