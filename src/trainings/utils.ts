import pool from "../database.js";
import { encodeId } from "../shared/utils.js";
import { Errors, Models } from "../shared/enums.js";

export const mapTrainingRow = (row) => ({
  ...row,
  id: encodeId(Models.Training, row.id),
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const checkDuplication = async (
  name: string,
  userId: string,
  target_id: string,
  excludeId?: string
): Promise<void> => {
  const query = `
    SELECT id FROM trainings 
    WHERE created_by = $1 
    AND name = $2 
    AND archived_at IS NULL
    AND training_target = $3
    ${excludeId ? `AND id != $4` : ""}
  `;

  const params = [userId, name, target_id, ...(excludeId ? [excludeId] : [])];

  const result = await pool.query(query, params);
  if (result.rows.length > 0) {
    throw new Error("Treino já existe");
  }
};

export const errorMessage = (error: Errors) => {
  switch (error) {
    case Errors.NotExist:
      return "Treino não encontrado";
    case Errors.NotOwner:
      return "Não autorizado";
    default:
      return "Erro";
  }
};
