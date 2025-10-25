import pool from "../database.js";
import { Errors, Models } from "../shared/enums.js";
import { encodeId } from "../shared/utils.js";

export const mapCategoryRow = (row, subcategories) => ({
  id: encodeId(Models.Category, row.id),
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  parentCategory: row.parent_category
    ? encodeId(Models.Category, row.parent_category)
    : null,
  subcategories,
});

export const errorMessage = (error: Errors) => {
  switch (error) {
    case Errors.NotExist:
      return "Categoria não encontrada";
    case Errors.NotOwner:
      return "Não autorizado";
    default:
      return "Erro";
  }
};

export const checkDuplication = async (
  name: string,
  parentCategory: string | null,
  userId: string,
  excludeId?: string
): Promise<void> => {
  const query = `
    SELECT id FROM categories 
    WHERE created_by = $1 
    AND name = $2 
    AND archived_at IS NULL
    ${
      !parentCategory
        ? "AND parent_category IS NULL"
        : "AND parent_category = $3"
    }
    ${excludeId ? `AND id != $${!parentCategory ? 3 : 4}` : ""}
  `;

  const params = [
    userId,
    name,
    ...(parentCategory ? [parentCategory] : []),
    ...(excludeId ? [excludeId] : []),
  ];

  const result = await pool.query(query, params);
  if (result.rows.length > 0) {
    throw new Error("Categoria já existe");
  }
};

export const getSubcategories = async (
  parentIds: string[],
  userId: number
): Promise<Record<number, any[]>> => {
  if (parentIds.length === 0) return {};

  const query = `
    SELECT c.id, c.name, c.parent_category, c.created_at, c.updated_at
    FROM categories c
    WHERE c.parent_category = ANY($1::int[]) AND c.created_by = $2 AND c.archived_at IS NULL
  `;
  const result = await pool.query(query, [parentIds, userId]);

  return result.rows.reduce((acc, sub) => {
    if (!acc[sub.parent_category]) {
      acc[sub.parent_category] = [];
    }
    acc[sub.parent_category].push(mapCategoryRow(sub, []));
    return acc;
  }, {} as Record<number, any[]>);
};
