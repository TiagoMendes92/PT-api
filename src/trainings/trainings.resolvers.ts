import pool from "../database.js";
import { Models, Tables } from "../shared/enums.js";
import { decodeId, encodeId, uploadFile } from "../shared/utils.js";
import { checkExistenceAndOwnership, requireAuth } from "../user/utils.js";
import {
  checkDuplication,
  errorMessage as trainingErrorMessage,
  mapTrainingRow,
} from "./utils.js";
import { errorMessage as alunoErrorMessage } from "../pt_user/utils.js";

export default {
  Query: {
    trainings: async (
      _: any,
      args: {
        target_id: string;
      },
      context
    ) => {
      requireAuth(context);
      const { target_id } = args;

      if (!target_id) {
        throw new Error("Id do aluno é obrigatório");
      }
      const numericId = decodeId(Models.AdminUser, target_id);
      const error = await checkExistenceAndOwnership(
        Models.AdminUser,
        numericId,
        context.user.id
      );

      if (error) {
        throw new Error(alunoErrorMessage(error));
      }

      const query = `
        SELECT *
        FROM trainings t
        WHERE t.archived_at IS NULL
        AND t.created_by = $1
        AND t.training_target = $2
      `;

      const result = await pool.query(query, [context.user.id, numericId]);
      return result.rows.map((row) => mapTrainingRow(row));
    },
  },
  Mutation: {
    createTraining: async (
      _: any,
      {
        input,
        file,
      }: {
        input: {
          target_id: string;
          name: string;
          description: string;
          photo:
            | {
                url: string;
                key: string;
              }
            | undefined;
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
      const { name, description, exercises = [], target_id, photo } = input;

      if (!name || !exercises?.length || !target_id) {
        throw new Error("Pedido inválido");
      }
      const numericId = decodeId(Models.AdminUser, target_id);
      await checkDuplication(name, context.user.id, numericId);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const insertQuery = `
          INSERT INTO trainings (name, description, created_by, training_target)
          VALUES ($1, $2, $3, $4) 
          RETURNING *
        `;
        const insertParams = [name, description, context.user.id, numericId];
        const result = await client.query(insertQuery, insertParams);
        const training = result.rows[0];

        const exerciseValues = exercises
          .map((ex, idx) => `($1, $${idx * 2 + 2}, $${idx * 2 + 3})`)
          .join(", ");
        const exerciseParams = [training.id];
        exercises.forEach((ex) => {
          exerciseParams.push(
            decodeId(Models.Exercise, ex.exerciseId),
            ex.orderPosition
          );
        });

        const exerciseQuery = `
          INSERT INTO training_exercises (training_id, exercise_id, order_position)
          VALUES ${exerciseValues}
          RETURNING *
        `;
        const exerciseResult = await client.query(
          exerciseQuery,
          exerciseParams
        );
        const trainingExercises = exerciseResult.rows;

        for (let i = 0; i < exercises.length; i++) {
          const ex = exercises[i];
          const trainingExercise = trainingExercises[i];

          if (ex.sets && ex.sets.length > 0) {
            const allVariables: any[] = [];
            ex.sets.forEach((set) => {
              set.variables.forEach((variable) => {
                allVariables.push({
                  trainingExerciseId: trainingExercise.id,
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
                  v.trainingExerciseId,
                  v.setNumber,
                  v.variableId,
                  v.targetValue
                );
              });

              const variableQuery = `
                INSERT INTO training_exercise_set_variables 
                (training_exercise_id, set_number, exercise_variable_id, target_value)
                VALUES ${variableValues}
              `;
              await client.query(variableQuery, variableParams);
            }
          }
        }
        if (file) {
          await uploadFile(pool, Tables.TRAINING, training.id, file);
        } else if (photo) {
          await pool.query(
            `INSERT INTO photos (model, model_id, photography_url, photography_key)
             VALUES ($1, $2, $3, $4)
          `,
            [Tables.TRAINING, training.id, photo.url, photo.key]
          );
        }

        await client.query("COMMIT");
        return mapTrainingRow(training);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    editTraining: async (
      _: any,
      {
        input,
      }: {
        input: {
          training_id: string;
          exercises: {
            exerciseId: string;
            orderPosition: number;
            sets: {
              setNumber: number;
              variables: {
                id: string;
                variableId: string;
                targetValue?: string;
              }[];
            }[];
          }[];
        };
      },
      context
    ) => {
      requireAuth(context);
      const { exercises = [], training_id } = input;

      if (!exercises?.length || !training_id) {
        throw new Error("Pedido inválido");
      }
      const numericId = decodeId(Models.Training, training_id);
      const error = await checkExistenceAndOwnership(
        Models.Training,
        numericId,
        context.user.id
      );

      if (error) {
        throw new Error(trainingErrorMessage(error));
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        for (const ex of exercises) {
          for (const set of ex.sets) {
            for (const variable of set.variables) {
              const updateQuery = `
                UPDATE training_exercise_set_variables
                SET target_value = $1
                WHERE id = $2
              `;

              await client.query(updateQuery, [
                variable.targetValue,
                variable.id,
              ]);
            }
          }
        }

        const query = `
          SELECT *
          FROM trainings t
          WHERE id = $1
      `;

        const result = await pool.query(query, [numericId]);
        await client.query("COMMIT");
        return mapTrainingRow(result.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  },
  Training: {
    photo: async (parent: any, _: any, context: any) => {
      const numericId = decodeId(Models.Training, parent.id);
      const result = await pool.query(
        `SELECT photography_url, photography_key 
         FROM photos 
         WHERE model = $1 AND model_id = $2`,
        [Tables.TRAINING, numericId]
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
        FROM training_exercises te
        WHERE te.training_id = $1
      `;
      const numericId = decodeId(Models.Training, parent.id);
      const exercises = await pool.query(query, [numericId]);
      return exercises.rows.map((r) => ({
        id: encodeId(Models.TrainingExercises, r.id),
        orderPosition: r.order_position,
      }));
    },
  },
  TrainingExercise: {
    exercise: async (parent, _) => {
      const query = `
        SELECT 
          e.id, 
          e.name,
          e.url,
          c.name as category
        FROM training_exercises te
        LEFT JOIN exercises e ON e.id = te.exercise_id
        LEFT JOIN categories c ON c.id = e.category
        WHERE te.id = $1
      `;
      const numericId = decodeId(Models.TrainingExercises, parent.id);
      const result = await pool.query(query, [numericId]);
      return {
        ...result.rows[0],
        id: encodeId(Models.Exercise, result.rows[0].id),
      };
    },
    sets: async (parent, _) => {
      const query = `
        SELECT 
          tesv.id,
          tesv.set_number,
          tesv.target_value,
          ev.id as variable_id,
          ev.name as variable_name,
          ev.description as variable_description,
          ev.unit as variable_unit
        FROM training_exercise_set_variables tesv
        LEFT JOIN exercise_variables ev ON ev.id = tesv.exercise_variable_id
        WHERE tesv.training_exercise_id = $1
        ORDER BY tesv.set_number ASC, ev.name ASC
      `;
      const numericId = decodeId(Models.TrainingExercises, parent.id);
      const result = await pool.query(query, [numericId]);

      const setMap = new Map<number, any>();
      result.rows.forEach((row) => {
        if (!setMap.has(row.set_number)) {
          setMap.set(row.set_number, {
            setNumber: row.set_number,
            variables: [],
          });
        }
        setMap.get(row.set_number).variables.push({
          id: row.id,
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
