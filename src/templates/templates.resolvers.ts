import pool from "../database.js";
import { Models } from "../shared/enums.js";
import {
  decodeId,
  deletePhoto,
  encodeId,
  uploadFile,
} from "../shared/utils.js";
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
      {
        input,
        file,
      }: {
        input: {
          name: string;
          description: string;
          exercises: {
            exerciseId: string;
            orderPosition: number;
            sets: {
              setNumber: number;
              variables: {
                variableId: string;
                targetValue?: string;
              }[];
            }[];
          }[];
        };
        file: any;
      },
      context
    ) => {
      requireAuth(context);

      const { name, description, exercises = [] } = input;
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

        const exerciseResult = await client.query(
          exerciseQuery,
          exerciseParams
        );
        const templateExercises = exerciseResult.rows;

        for (let i = 0; i < exercises.length; i++) {
          const ex = exercises[i];
          const templateExercise = templateExercises[i];

          if (ex.sets && ex.sets.length > 0) {
            const allVariables: any[] = [];

            ex.sets.forEach((set) => {
              set.variables.forEach((variable) => {
                allVariables.push({
                  templateExerciseId: templateExercise.id,
                  setNumber: set.setNumber,
                  variableId: decodeId(
                    Models.ExerciseVariables,
                    variable.variableId
                  ),
                  targetValue: variable.targetValue || null,
                });
              });
            });

            if (allVariables.length > 0) {
              const variableValues = allVariables
                .map(
                  (_, idx) =>
                    `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${
                      idx * 4 + 4
                    })`
                )
                .join(", ");

              const variableParams: any[] = [];
              allVariables.forEach((v) => {
                variableParams.push(
                  v.templateExerciseId,
                  v.setNumber,
                  v.variableId,
                  v.targetValue
                );
              });

              const variableQuery = `
                INSERT INTO template_exercise_set_variables 
                (template_exercise_id, set_number, exercise_variable_id, target_value)
                VALUES ${variableValues}
              `;

              await client.query(variableQuery, variableParams);
            }
          }
        }

        await uploadFile(pool, "templates", template.id, file);
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
      {
        input,
        file,
      }: {
        input: {
          id: string;
          name: string;
          description: string;
          exercises: {
            exerciseId: string;
            orderPosition: number;
            sets: {
              setNumber: number;
              variables: {
                variableId: string;
                targetValue?: string;
              }[];
            }[];
          }[];
        };
        file: any;
      },
      context
    ) => {
      requireAuth(context);

      const { id, name, description, exercises = [] } = input;
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

      await checkDuplication(name, context.user.id, numericId);

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

        const exerciseResult = await client.query(
          exerciseQuery,
          exerciseParams
        );
        const templateExercises = exerciseResult.rows;

        for (let i = 0; i < exercises.length; i++) {
          const ex = exercises[i];
          const templateExercise = templateExercises[i];

          if (ex.sets && ex.sets.length > 0) {
            const allVariables: any[] = [];

            ex.sets.forEach((set) => {
              set.variables.forEach((variable) => {
                allVariables.push({
                  templateExerciseId: templateExercise.id,
                  setNumber: set.setNumber,
                  variableId: decodeId(
                    Models.ExerciseVariables,
                    variable.variableId
                  ),
                  targetValue: variable.targetValue || null,
                });
              });
            });

            if (allVariables.length > 0) {
              const variableValues = allVariables
                .map(
                  (_, idx) =>
                    `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${
                      idx * 4 + 4
                    })`
                )
                .join(", ");

              const variableParams: any[] = [];
              allVariables.forEach((v) => {
                variableParams.push(
                  v.templateExerciseId,
                  v.setNumber,
                  v.variableId,
                  v.targetValue
                );
              });

              const variableQuery = `
                INSERT INTO template_exercise_set_variables 
                (template_exercise_id, set_number, exercise_variable_id, target_value)
                VALUES ${variableValues}
              `;

              await client.query(variableQuery, variableParams);
            }
          }
        }

        await client.query("COMMIT");
        await uploadFile(pool, "templates", numericId, file);
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

      await deletePhoto(pool, "templates", numericId);

      return id;
    },
  },
  Template: {
    photo: async (parent: any, _: any, context: any) => {
      const numericId = decodeId(Models.Template, parent.id);

      const result = await pool.query(
        `SELECT photography_url, photography_key 
         FROM photos 
         WHERE model = $1 AND model_id = $2`,
        ["templates", numericId]
      );

      if (result.rows.length === 0) return null;

      return {
        url: result.rows[0].photography_url,
        key: result.rows[0].photography_key,
      };
    },
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
        id: encodeId(Models.TemplateExercises, r.id),
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

      const numbericId = decodeId(Models.TemplateExercises, parent.id);
      const result = await pool.query(query, [numbericId]);

      return {
        ...result.rows[0],
        id: encodeId(Models.Exercise, result.rows[0].id),
      };
    },
    sets: async (parent, _) => {
      const query = `
        SELECT 
          tesv.set_number,
          tesv.target_value,
          ev.id as variable_id,
          ev.name as variable_name,
          ev.description as variable_description,
          ev.unit as variable_unit
        FROM template_exercise_set_variables tesv
        LEFT JOIN exercise_variables ev ON ev.id = tesv.exercise_variable_id
        WHERE tesv.template_exercise_id = $1
        ORDER BY tesv.set_number ASC, ev.name ASC
      `;

      const numbericId = decodeId(Models.TemplateExercises, parent.id);
      const result = await pool.query(query, [numbericId]);
      const setMap = new Map<number, any>();

      result.rows.forEach((row) => {
        if (!setMap.has(row.set_number)) {
          setMap.set(row.set_number, {
            setNumber: row.set_number,
            variables: [],
          });
        }

        setMap.get(row.set_number).variables.push({
          variable: {
            id: encodeId(Models.ExerciseVariables, row.variable_id),
            name: row.variable_name,
            description: row.variable_description,
            unit: row.variable_unit,
          },
          targetValue: row.target_value,
        });
      });

      return Array.from(setMap.values());
    },
  },
};
