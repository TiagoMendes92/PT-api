import { Models } from "../shared/enums.js";
import { encodeId } from "../shared/utils.js";

export const mapAlunoRow = (row) => ({
  ...row,
  id: encodeId(Models.UserDetails, row.id),
  userId: encodeId(Models.AdminUser, row.user_id),
  photographyUrl: row.photography_url,
  photographyKey: row.photography_key,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
