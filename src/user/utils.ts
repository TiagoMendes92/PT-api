import pool from "../database.js";
import { Errors, Models, Tables } from "../shared/enums.js";

export const requireAuth = (context: any) => {
  if (!context.user) {
    throw new Error("Não autorizado");
  }
};

export const checkExistenceAndOwnership = async (
  type: Models,
  objectId: string,
  userId: string
): Promise<Errors | void> => {
  const query = `SELECT id, created_by
        FROM ${Tables[type]}
        WHERE id = $1
        AND created_by = $2
        LIMIT 1
    `;
  const result = await pool.query(query, [objectId, userId]);
  if (!result.rows.length) return Errors.NotExist;
  const { created_by } = result.rows[0];
  if (created_by !== userId) return Errors.NotOwner;
};

export const checkExistence = async (
  type: Models,
  objectId: string,
  userId: string
): Promise<Errors | void> => {
  const query = `SELECT id
        FROM ${Tables[type]}
        WHERE id = $1
        LIMIT 1
    `;
  const result = await pool.query(query, [objectId]);
  if (!result.rows.length) return Errors.NotExist;
};
