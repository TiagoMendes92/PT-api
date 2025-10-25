import pool from "../database.js";
import { Errors, Models } from "../shared/enums.js";
import { encodeId } from "../shared/utils.js";

export const mapUserRow = (row) => ({
  ...row,
  id: encodeId(Models.AdminUser, row.id),
  roleId: row.role_id,
  status: row.status.toUpperCase(),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
  deactivatedAt: row.deactivated_at,
  createdBy: row.created_by,
  registrationToken: row.registration_token,
  registrationTokenExpiresAt: row.registration_token_expires_at,
  passwordSetAt: row.password_set_at,
});

export const checkDuplication = async (
  email: string,
  userId: string,
  excludeId?: string
): Promise<void> => {
  const query = `
    SELECT id FROM users 
    WHERE created_by = $1 
    AND email = $2 
    AND archived_at IS NULL
    ${excludeId ? `AND id != $3` : ""}
  `;

  const params = [userId, email, ...(excludeId ? [excludeId] : [])];

  const result = await pool.query(query, params);
  if (result.rows.length > 0) {
    throw new Error("Já existe um aluno com esse e-mail");
  }
};

export const errorMessage = (error: Errors) => {
  switch (error) {
    case Errors.NotExist:
      return "Aluno não encontrado";
    case Errors.NotOwner:
      return "Não autorizado";
    default:
      return "Erro";
  }
};
