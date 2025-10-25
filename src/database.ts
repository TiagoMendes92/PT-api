import { Pool } from "pg";

const pool = new Pool({
  user: process.env.USER,
  host: "localhost",
  database: "pt",
  password: process.env.PASS,
  port: 5432,
});

export default pool;

export const JWT_SECRET = "your-secret-key-change-this-in-production";
