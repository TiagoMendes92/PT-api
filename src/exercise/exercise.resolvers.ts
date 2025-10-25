import {
  errorMessage as categoryErrorMessage,
  getSubcategories,
  mapCategoryRow,
} from "../category/utils.js";
import pool from "../database.js";
import { Models } from "../shared/enums.js";
import { decodeId } from "../shared/utils.js";
import { checkExistenceAndOwnership, requireAuth } from "../user/utils.js";
import {
  checkDuplication,
  errorMessage as exerciseErrorMessage,
  mapExerciseRow,
} from "./utils.js";

export default {
  Query: {
    exercises: async (
      _: any,
      args: {
        first?: number;
        after?: string;
        category?: string;
        searchTerm?: string;
      },
      context
    ) => {
      requireAuth(context);

      const { first = 10, after, category, searchTerm } = args;

      if (first < 0) {
        throw new Error("'first' must be positive");
      }

      const limit = first;
      const afterId = after
        ? Buffer.from(after, "base64").toString("utf-8")
        : null;

      let query = `
        SELECT e.*, c.name as category_name
        FROM exercises e
        JOIN categories c ON e.category = c.id
        WHERE e.created_by = $1 AND e.archived_at IS NULL
    `;
      const params: any[] = [context.user.id];
      let paramIndex = 2;

      if (category) {
        const numericCategory = decodeId(Models.Category, category);
        const subcategories = await getSubcategories(
          [numericCategory],
          context.user.id
        );
        const subcategoryIds = [
          ...new Set(
            Object.values(subcategories).flatMap((arr) =>
              arr.map((item) => decodeId(Models.Category, item.id))
            )
          ),
        ];

        if (subcategoryIds.length > 0) {
          query += ` AND e.category = ANY($${paramIndex})`;
          params.push([numericCategory, ...subcategoryIds]);
        } else {
          query += ` AND e.category = $${paramIndex}`;
          params.push(numericCategory);
        }
        paramIndex++;
      }

      if (searchTerm && searchTerm.trim()) {
        query += ` AND e.name ILIKE $${paramIndex}`;
        params.push(`%${searchTerm.trim()}%`);
        paramIndex++;
      }

      if (afterId) {
        query += ` AND e.id > $${paramIndex}`;
        params.push(afterId);
        paramIndex++;
      }

      query += ` ORDER BY e.id ASC`;
      query += ` LIMIT $${paramIndex}`;
      params.push(limit + 1);

      const result = await pool.query(query, params);
      const rows = result.rows;

      const hasMore = rows.length > limit;
      if (hasMore) {
        rows.pop();
      }

      const edges = rows.map((row) => ({
        cursor: Buffer.from(row.id.toString()).toString("base64"),
        node: mapExerciseRow(row),
      }));

      const pageInfo = {
        hasNextPage: hasMore,
        hasPreviousPage: false,
        startCursor: edges.length > 0 ? edges[0].cursor : null,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
      };

      return {
        edges,
        pageInfo,
      };
    },
  },
  Mutation: {
    addExercise: async (
      _: any,
      body: { exercise: { name: string; category: string; url: string } },
      context
    ) => {
      requireAuth(context);
      const { name, category, url } = body.exercise;

      if (!name || !category || !url) {
        throw new Error("Pedido inválido");
      }

      const numericCategory = decodeId(Models.Category, category);

      const error = await checkExistenceAndOwnership(
        Models.Category,
        numericCategory,
        context.user.id
      );
      if (error) {
        throw new Error(categoryErrorMessage(error));
      }

      await checkDuplication(name, context.user.id);

      const insertQuery = `
          INSERT INTO exercises (name, category, url, created_by) 
          VALUES ($1, $2, $3, $4) 
          RETURNING *
        `;

      const insertParams = [name, numericCategory, url, context.user.id];
      const result = await pool.query(insertQuery, insertParams);
      return mapExerciseRow(result.rows[0]);
    },
    editExercise: async (
      _: any,
      body: {
        exercise: { id: string; name: string; category: string; url: string };
      },
      context
    ) => {
      requireAuth(context);
      const { id, name, category, url } = body.exercise;
      if (!name || !category || !url) {
        throw new Error("Pedido inválido");
      }

      const numericId = decodeId(Models.Exercise, id);
      const numericCategory = decodeId(Models.Category, category);

      const error = await checkExistenceAndOwnership(
        Models.Category,
        numericCategory,
        context.user.id
      );
      if (error) {
        throw new Error(categoryErrorMessage(error));
      }

      const error2 = await checkExistenceAndOwnership(
        Models.Exercise,
        numericId,
        context.user.id
      );

      if (error2) {
        throw new Error(exerciseErrorMessage(error2));
      }

      await checkDuplication(name, context.user.id, numericId);

      const updateQuery = `
        UPDATE exercises 
        SET name = $1, category = $2, url = $3, updated_at = NOW() 
        WHERE id = $4 
        RETURNING *
      `;

      const updateParams = [name, numericCategory, url, numericId];
      const result = await pool.query(updateQuery, updateParams);
      return mapExerciseRow(result.rows[0]);
    },
    deleteExercise: async (_: any, body: { id: string }, context) => {
      requireAuth(context);
      const { id } = body;
      const numericId = decodeId(Models.Exercise, id);

      const error = await checkExistenceAndOwnership(
        Models.Exercise,
        numericId,
        context.user.id
      );

      if (error) {
        throw new Error(exerciseErrorMessage(error));
      }

      await pool.query(
        `UPDATE exercises SET archived_at = CURRENT_TIMESTAMP, updated_at = NOW()  WHERE id = $1`,
        [numericId]
      );

      return id;
    },
  },
  Exercise: {
    allCategories: async (parent, _, { db }) => {
      const numericId = decodeId(Models.Exercise, parent.id);
      const query = `
            SELECT c.* FROM categories c
            LEFT JOIN exercises e ON e.category = c.id
            WHERE e.id = $1 
        `;
      const result = await pool.query(query, [numericId]);
      const cat = result.rows[0];
      let parentCat = null;

      if (cat.parent_category) {
        const parentQuery = `
            SELECT c.* FROM categories c
            WHERE c.id = $1 
        `;
        const parentResult = await pool.query(parentQuery, [
          cat.parent_category,
        ]);
        parentCat = parentResult.rows[0];
      }
      return [
        ...(parentCat ? [mapCategoryRow(parentCat, [])] : []),
        mapCategoryRow(cat, []),
      ];
    },
  },
};
