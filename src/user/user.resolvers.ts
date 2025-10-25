import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool, { JWT_SECRET } from "../database.js";

export default {
  Query: {
    me: async (_: any, __: any, context: any) => {
      if (!context.user) {
        throw new Error("Not authenticated");
      }

      const result = await pool.query(
        `SELECT u.id, u.email, u.name, u.created_at, r.id as role_id, r.name as role_name
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         WHERE u.id = $1 AND u.status = 'active'`,
        [context.user.id]
      );

      if (result.rows.length === 0) {
        throw new Error("User not found");
      }

      const user = result.rows[0];
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role_name,
        created_at: user.created_at,
      };
    },
  },
  Mutation: {
    login: async (_: any, { email, password }: any) => {
      const result = await pool.query(
        `SELECT u.*, r.id as role_id, r.name as role_name
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         WHERE u.email = $1 AND u.status = 'active'`,
        [email]
      );

      if (result.rows.length === 0) {
        throw new Error("Invalid credentials");
      }

      const user = result.rows[0];

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        throw new Error("Invalid credentials");
      }

      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
        expiresIn: "7d",
      });

      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role_name,
          created_at: user.created_at,
        },
      };
    },
  },
};
