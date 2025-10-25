import { v2 as cloudinary } from "cloudinary";
import pool from "../database.js";
import { requireAuth } from "../user/utils.js";
import { mapAlunoRow } from "./utils.js";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default {
  Mutation: {
    updateUserDetails: async (
      _,
      { birthday, height, weight, sex },
      context
    ) => {
      requireAuth(context);
      const updateFields = [];
      const values = [context.user.id];
      let paramCount = 2;

      if (birthday) {
        updateFields.push(`birthday = $${paramCount}`);
        values.push(birthday);
        paramCount++;
      }

      if (height) {
        updateFields.push(`height = $${paramCount}`);
        values.push(height);
        paramCount++;
      }

      if (weight) {
        updateFields.push(`weight = $${paramCount}`);
        values.push(weight);
        paramCount++;
      }

      if (sex) {
        updateFields.push(`sex = $${paramCount}`);
        values.push(sex);
        paramCount++;
      }

      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

      const query = `
        INSERT INTO user_details (user_id, birthday, height, weight, sex, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id) DO UPDATE SET
          ${updateFields.join(", ")}
        RETURNING *
      `;

      const result = await pool.query(query, values);
      return mapAlunoRow(result.rows[0]);
    },

    uploadProfilePhoto: async (_, { file }, context: any) => {
      requireAuth(context);
      const uploadedFile = await file;

      if (!uploadedFile) {
        throw new Error("Fotografia é obrigatória");
      }
      const { createReadStream } = uploadedFile.file;

      const oldDetailsResult = await pool.query(
        `SELECT photography_key FROM user_details WHERE user_id = $1`,
        [context.user.id]
      );

      const uploadResult: {
        secure_url: string;
        public_id: string;
      } = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: `users/${context.user.id}`,
            resource_type: "auto",
            quality: "auto",
            fetch_format: "auto",
          },
          (error, result) => {
            if (error) reject(error);
            resolve(result);
          }
        );
        createReadStream().pipe(uploadStream);
      });

      const result = await pool.query(
        `INSERT INTO user_details (user_id, photography_url, photography_key, created_at, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         photography_url = $2,
         photography_key = $3,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
        [context.user.id, uploadResult.secure_url, uploadResult.public_id]
      );

      if (oldDetailsResult.rows[0]?.photography_key) {
        await cloudinary.uploader.destroy(
          oldDetailsResult.rows[0].photography_key
        );
      }

      return mapAlunoRow(result.rows[0]);
    },
  },

  Query: {
    async userDetails(_, { user_id }, context: any) {
      requireAuth(context);

      const result = await pool.query(
        `SELECT id, user_id, birthday, height, weight, sex, photography_url, photography_key, created_at, updated_at
         FROM user_details WHERE user_id = $1`,
        [context.user.id]
      );

      if (!result.rows[0]) {
        throw new Error("Não existe");
      }

      return mapAlunoRow(result.rows[0]);
    },
  },
};
