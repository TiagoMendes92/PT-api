import pool from "../database.js";
import { Errors, Models } from "../shared/enums.js";
import { encodeId } from "../shared/utils.js";

export const mapExerciseRow = (row) => ({
  id: encodeId(Models.Exercise, row.id),
  name: row.name,
  url: row.url,
  category: encodeId(Models.Category, row.category),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const getCategoriesExercises = async (
  categoryIds: string[],
  userId: number
): Promise<any[]> => {
  const query = `SELECT id from exercises WHERE category = ANY($1::int[]) AND created_by = $2`;

  const result = await pool.query(query, [categoryIds, userId]);
  return result.rows;
};

export const checkDuplication = async (
  name: string,
  userId: string,
  excludeId?: string
): Promise<void> => {
  const query = `
    SELECT id FROM exercises 
    WHERE created_by = $1 
    AND name = $2 
    AND archived_at IS NULL
    ${excludeId ? `AND id != $3` : ""}
  `;

  const params = [userId, name, ...(excludeId ? [excludeId] : [])];

  const result = await pool.query(query, params);
  if (result.rows.length > 0) {
    throw new Error("Exercício já existe");
  }
};

export const errorMessage = (error: Errors) => {
  switch (error) {
    case Errors.NotExist:
      return "Exercício não encontrado";
    case Errors.NotOwner:
      return "Não autorizado";
    default:
      return "Erro";
  }
};
