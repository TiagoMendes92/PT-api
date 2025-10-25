import pool from "../database.js";
import { getCategoriesExercises } from "../exercise/utils.js";
import { Models } from "../shared/enums.js";
import { decodeId, encodeId } from "../shared/utils.js";
import { checkExistenceAndOwnership, requireAuth } from "../user/utils.js";
import {
  checkDuplication,
  errorMessage,
  getSubcategories,
  mapCategoryRow,
} from "./utils.js";

export default {
  Query: {
    categories: async (_: any, {}, context: any) => {
      requireAuth(context);

      const query = `
        SELECT c.id, c.name, c.parent_category, c.created_at, c.updated_at
        FROM categories c
        WHERE c.parent_category IS NULL AND c.created_by = $1 AND c.archived_at IS NULL
        ORDER BY c.updated_at DESC, c.name ASC
      `;

      const result = await pool.query(query, [context.user.id]);
      const ids = result.rows.map(({ id }) => id);

      const subcategories = await getSubcategories(ids, context.user.id);

      return result.rows.map((row) =>
        mapCategoryRow(row, subcategories[row.id] || [])
      );
    },
  },
  Mutation: {
    addCategory: async (
      _: any,
      body: { cat: { name: string; parent_category: string } },
      context
    ) => {
      requireAuth(context);
      const { name, parent_category } = body.cat;
      const numericParentCategory = decodeId(Models.Category, parent_category);
      await checkDuplication(name, numericParentCategory, context.user.id);

      const insertQuery = `
          INSERT INTO categories (name, parent_category, created_by) 
          VALUES ($1, $2, $3) 
          RETURNING *
        `;
      const insertParams = [
        name,
        numericParentCategory || null,
        context.user.id,
      ];

      const result = await pool.query(insertQuery, insertParams);
      return mapCategoryRow(result.rows[0], []);
    },
    editCategory: async (
      _: any,
      body: { cat: { id: string; name: string; parent_category?: string } },
      context
    ) => {
      requireAuth(context);
      const { name, id, parent_category } = body.cat;
      const numericId = decodeId(Models.Category, id);

      const error = await checkExistenceAndOwnership(
        Models.Category,
        numericId,
        context.user.id
      );

      if (error) {
        const erroMessage = errorMessage(error);
        throw new Error(erroMessage);
      }

      const numericParentCategory = decodeId(Models.Category, parent_category);
      await checkDuplication(
        name,
        numericParentCategory,
        context.user.id,
        numericId
      );

      const updateQuery = `
        UPDATE categories 
        SET name = $1, parent_category = $2, updated_at = NOW() 
        WHERE id = $3 
        RETURNING *
      `;

      const updateParams = [name, numericParentCategory, numericId];
      const result = await pool.query(updateQuery, updateParams);

      return mapCategoryRow(result.rows[0], []);
    },
    deleteCategory: async (_: any, body: { id: string }, context) => {
      requireAuth(context);
      const { id } = body;
      const numericId = decodeId(Models.Category, id);

      const error = await checkExistenceAndOwnership(
        Models.Category,
        numericId,
        context.user.id
      );

      if (error) {
        throw new Error(errorMessage(error));
      }

      const subcategories = await getSubcategories(
        [numericId],
        context.user.id
      );
      const subcategoryIds = [
        ...new Set(
          Object.values(subcategories).flatMap((arr) =>
            arr.map((item) => decodeId(Models.Category, item.id))
          )
        ),
      ];

      const categoryIds = [numericId, ...subcategoryIds];

      const exercises = await getCategoriesExercises(
        categoryIds,
        context.user.id
      );

      if (exercises?.length > 0) {
        throw new Error(
          "Não é possível eliminar categoria com exercícios associados"
        );
      }

      if (subcategoryIds.length > 0) {
        await pool.query(
          `UPDATE categories SET archived_at = CURRENT_TIMESTAMP WHERE parent_category = $1`,
          [numericId]
        );
      }

      await pool.query(
        `UPDATE categories SET archived_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [numericId]
      );

      return id;
    },
  },
};
