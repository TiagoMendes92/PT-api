import pool from "../database.js";

export default {
  Query: {
    roles: async () => {
      const result = await pool.query("SELECT * FROM roles");
      return result.rows;
    },
  },
};
