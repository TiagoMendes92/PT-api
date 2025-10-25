import pool from "../database.js";
import { Models } from "../shared/enums.js";
import { decodeId, encodeId } from "../shared/utils.js";
import { checkExistenceAndOwnership, requireAuth } from "../user/utils.js";
import { checkDuplication, mapTemplateRow } from "./utils.js";
import { errorMessage as templateErrorMessage } from "./utils.js";

export default {
  Query: {
    templates: async (
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
        SELECT *
        FROM templates t
        WHERE t.archived_at IS NULL
        AND t.created_by = $1
    `;
      const params: any[] = [context.user.id];
      let paramIndex = 2;

      if (searchTerm && searchTerm.trim()) {
        query += ` AND t.name ILIKE $${paramIndex}`;
        params.push(`%${searchTerm.trim()}%`);
        paramIndex++;
      }

      if (afterId) {
        query += ` AND t.id > $${paramIndex}`;
        params.push(afterId);
        paramIndex++;
      }

      query += ` ORDER BY t.id ASC`;
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
        node: mapTemplateRow(row),
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
    createTemplate: async (
      _: any,
      body: {
        input: {
          name: string;
          description: string;
          exercises: {
            exerciseId: string;
            orderPosition: number;
          }[];
        };
      },
      context
    ) => {
      requireAuth(context);

      const { name, description, exercises = [] } = body.input;
      if (!name || !exercises?.length) {
        throw new Error("Pedido inválido");
      }

      await checkDuplication(name, context.user.id);

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        const insertQuery = `
          INSERT INTO templates (name, description, created_by)
          VALUES ($1, $2, $3) 
          RETURNING *
        `;
        const insertParams = [name, description, context.user.id];
        const result = await client.query(insertQuery, insertParams);
        const template = result.rows[0];

        const exerciseValues = exercises
          .map((ex, idx) => `($1, $${idx * 2 + 2}, $${idx * 2 + 3})`)
          .join(", ");

        const exerciseParams = [template.id];
        exercises.forEach((ex) => {
          exerciseParams.push(
            decodeId(Models.Exercise, ex.exerciseId),
            ex.orderPosition
          );
        });

        const exerciseQuery = `
          INSERT INTO template_exercises (template_id, exercise_id, order_position)
          VALUES ${exerciseValues}
          RETURNING *
        `;

        await client.query(exerciseQuery, exerciseParams);

        await client.query("COMMIT");

        return mapTemplateRow(template);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    updateTemplate: async (
      _: any,
      body: {
        input: {
          id: string;
          name: string;
          description: string;
          exercises: {
            exerciseId: string;
            orderPosition: number;
          }[];
        };
      },
      context
    ) => {
      requireAuth(context);

      const { id, name, description, exercises = [] } = body.input;
      if (!id || !name || !exercises?.length) {
        throw new Error("Pedido inválido");
      }

      const numericId = decodeId(Models.Template, id);
      const error = await checkExistenceAndOwnership(
        Models.Template,
        numericId,
        context.user.id
      );

      if (error) {
        throw new Error(templateErrorMessage(error));
      }

      await checkDuplication(name, context.user.id);

      const client = await pool.connect();

      try {
        const updateQuery = `
          UPDATE templates 
          SET name = $1, description = $2, updated_at = NOW() 
          WHERE id = $3 
          RETURNING *
        `;
        const updateParams = [name, description, numericId];
        const result = await client.query(updateQuery, updateParams);
        const template = result.rows[0];

        await client.query(
          "DELETE FROM template_exercises WHERE template_id = $1",
          [template.id]
        );

        const exerciseValues = exercises
          .map((ex, idx) => `($1, $${idx * 2 + 2}, $${idx * 2 + 3})`)
          .join(", ");

        const exerciseParams = [template.id];
        exercises.forEach((ex) => {
          exerciseParams.push(
            decodeId(Models.Exercise, ex.exerciseId),
            ex.orderPosition
          );
        });

        const exerciseQuery = `
          INSERT INTO template_exercises (template_id, exercise_id, order_position)
          VALUES ${exerciseValues}
          RETURNING *
        `;

        await client.query(exerciseQuery, exerciseParams);
        await client.query("COMMIT");
        return mapTemplateRow(template);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    deleteTemplate: async (_: any, body: { id: string }, context) => {
      requireAuth(context);
      const { id } = body;
      const numericId = decodeId(Models.Template, id);

      const error = await checkExistenceAndOwnership(
        Models.Template,
        numericId,
        context.user.id
      );

      if (error) {
        throw new Error(templateErrorMessage(error));
      }

      await pool.query(
        `UPDATE templates SET archived_at = CURRENT_TIMESTAMP, updated_at = NOW()  WHERE id = $1`,
        [numericId]
      );

      return id;
    },
  },
  Template: {
    exercises: async (parent, _) => {
      const query = `
        SELECT 
          te.id,
          te.order_position
        FROM template_exercises te
        WHERE te.template_id = $1
      `;
      const numbericId = decodeId(Models.Template, parent.id);
      const exercises = await pool.query(query, [numbericId]);

      return exercises.rows.map((r) => ({
        id: encodeId(Models.Exercise, r.id),
        orderPosition: r.order_position,
      }));
    },
  },
  TemplateExercise: {
    exercise: async (parent, _) => {
      const query = `
        SELECT 
          e.id, 
          e.name,
          e.url,
          c.name as category
        FROM template_exercises te
        LEFT JOIN exercises e ON e.id = te.exercise_id
        LEFT JOIN categories c ON c.id = e.category
        WHERE te.id = $1
        `;
      const numbericId = decodeId(Models.Exercise, parent.id);
      const result = await pool.query(query, [numbericId]);

      return {
        ...result.rows[0],
        id: encodeId(Models.Exercise, result.rows[0].id),
      };
    },
  },
};
