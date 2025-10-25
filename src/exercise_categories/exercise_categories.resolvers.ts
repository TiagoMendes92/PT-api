import { checkExistenceAndOwnership, requireAuth } from "../user/utils.js";
import pool from "../database.js";
import {
  checkDuplication,
  errorMessage,
  mapExerciseVariableRow,
} from "./utils.js";
import { decodeId } from "../shared/utils.js";
import { Models } from "../shared/enums.js";

export default {
  Query: {
    exerciseVariables: async (
      _: any,
      args: {
        first?: number;
        after?: string;
        searchTerm?: string;
      },
      context
    ) => {
      requireAuth(context);

      const { first = 10, after, searchTerm } = args;

      if (first < 0) {
        throw new Error("'first' must be positive");
      }

      const limit = first;
      const afterId = after
        ? Buffer.from(after, "base64").toString("utf-8")
        : null;

      let query = `
        SELECT ev.*
        FROM exercise_variables ev
        WHERE ev.created_by = $1 AND ev.archived_at IS NULL
    `;
      const params: any[] = [context.user.id];
      let paramIndex = 2;

      if (searchTerm && searchTerm.trim()) {
        query += ` AND ev.name ILIKE $${paramIndex}`;
        params.push(`%${searchTerm.trim()}%`);
        paramIndex++;
      }

      if (afterId) {
        query += ` AND ev.id > $${paramIndex}`;
        params.push(afterId);
        paramIndex++;
      }

      query += ` ORDER BY ev.id ASC`;
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
        node: mapExerciseVariableRow(row),
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
    addExerciseVariable: async (
      _: any,
      body: {
        variable: {
          name: string;
          unit: string;
          description: string;
        };
      },
      context
    ) => {
      requireAuth(context);
      const { name, unit, description } = body.variable;

      if (!name || !unit) {
        throw new Error("Pedido inválido");
      }

      await checkDuplication(name, context.user.id);

      const insertQuery = `
          INSERT INTO exercise_variables (name, unit, description, created_by) 
          VALUES ($1, $2, $3, $4) 
          RETURNING *
        `;

      const insertParams = [name, unit, description, context.user.id];
      const result = await pool.query(insertQuery, insertParams);
      return mapExerciseVariableRow(result.rows[0]);
    },
    editExerciseVariable: async (
      _: any,
      body: {
        variable: {
          id: string;
          name: string;
          unit: string;
          description: string;
        };
      },
      context
    ) => {
      requireAuth(context);
      const { id, name, unit, description } = body.variable;
      if (!id || !name || !unit) {
        throw new Error("Pedido inválido");
      }

      const numericId = decodeId(Models.ExerciseVariables, id);

      const error = await checkExistenceAndOwnership(
        Models.ExerciseVariables,
        numericId,
        context.user.id
      );

      if (error) {
        throw new Error(errorMessage(error));
      }

      await checkDuplication(name, context.user.id, numericId);

      const updateQuery = `
        UPDATE exercise_variables 
        SET name = $1, unit = $2, description = $3, updated_at = NOW() 
        WHERE id = $4 
        RETURNING *
      `;

      const updateParams = [name, unit, description, numericId];

      const result = await pool.query(updateQuery, updateParams);
      return mapExerciseVariableRow(result.rows[0]);
    },

    deleteExerciseVariable: async (_: any, body: { id: string }, context) => {
      requireAuth(context);
      const { id } = body;
      const numericId = decodeId(Models.ExerciseVariables, id);

      const error = await checkExistenceAndOwnership(
        Models.ExerciseVariables,
        numericId,
        context.user.id
      );

      if (error) {
        throw new Error(errorMessage(error));
      }

      await pool.query(
        `UPDATE exercise_variables SET archived_at = CURRENT_TIMESTAMP, updated_at = NOW()  WHERE id = $1`,
        [numericId]
      );

      return id;
    },
  },
};
