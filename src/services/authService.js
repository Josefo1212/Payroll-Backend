import { db } from "../../db/Database.js";
import { queries } from "../queries/loader.js";

export const authenticateUser = async (username, password) => {
  const result = await db.query(queries.findUserByUsername, [username]);
  const user = result.rows[0];

  if (!user || password !== user.password_hash) {
    return null;
  }

  return user;
};
