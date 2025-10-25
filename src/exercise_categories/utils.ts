import pool from "../database.js";
import { Errors, Models } from "../shared/enums.js";
import { encodeId } from "../shared/utils.js";

export const mapExerciseVariableRow = (row) => ({
  ...row,
  id: encodeId(Models.ExerciseVariables, row.id),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const checkDuplication = async (
  name: string,
  userId: string,
  excludeId?: string
): Promise<void> => {
  const query = `
    SELECT id FROM exercise_variables
    WHERE created_by = $1 
    AND name = $2 
    AND archived_at IS NULL
    ${excludeId ? `AND id != $3` : ""}
  `;

  const params = [userId, name, ...(excludeId ? [excludeId] : [])];

  const result = await pool.query(query, params);
  if (result.rows.length > 0) {
    throw new Error("Variavel já existe");
  }
};

export const errorMessage = (error: Errors) => {
  switch (error) {
    case Errors.NotExist:
      return "Variavel não encontrado";
    case Errors.NotOwner:
      return "Não autorizado";
    default:
      return "Erro";
  }
};
