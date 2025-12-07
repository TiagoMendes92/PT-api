import { Models } from "./enums";
import type { Pool } from "pg";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const encodeId = (type: Models, id: number | string): string => {
  return `${type}-${id}`;
};

export const decodeId = (type: Models, encodeId: string): string | null => {
  if (!encodeId) return null;
  return encodeId.replace(`${type}-`, "");
};

export const uploadFile = async (
  pool: Pool,
  model: string,
  model_id: string,
  file: any
) => {
  if (!file) return;

  const uploadedFile = await file;

  const { createReadStream } = uploadedFile.file;

  const oldPhotoResult = await pool.query(
    `SELECT photography_key FROM photos WHERE model = $1 AND model_id = $2`,
    [model, model_id]
  );

  const uploadResult: {
    secure_url: string;
    public_id: string;
  } = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `${model}/${model_id}`,
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

  await pool.query(
    `INSERT INTO photos (model, model_id, photography_url, photography_key)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (model, model_id) DO UPDATE SET
             photography_url = $3,
             photography_key = $4,
             updated_at = CURRENT_TIMESTAMP`,
    [model, model_id, uploadResult.secure_url, uploadResult.public_id]
  );

  if (oldPhotoResult.rows[0]?.photography_key) {
    await cloudinary.uploader.destroy(oldPhotoResult.rows[0].photography_key);
  }
};

export const deletePhoto = async (
  pool: Pool,
  model: string,
  model_id: string
) => {
  const photoResult = await pool.query(
    `SELECT photography_key FROM photos WHERE model = $1 AND model_id = $2`,
    [model, model_id]
  );

  if (photoResult.rows[0]?.photography_key) {
    await cloudinary.uploader.destroy(photoResult.rows[0].photography_key);
  }

  await pool.query(`DELETE FROM photos WHERE model = $1 AND model_id = $2`, [
    "category",
    model_id,
  ]);
};
