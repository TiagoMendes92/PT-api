import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import pool from "../database.js";
import { checkExistenceAndOwnership, requireAuth } from "../user/utils.js";
import { checkDuplication, errorMessage, mapUserRow } from "./utils.js";
import { sendEmail } from "../mails/send_email.js";
import { decodeId } from "../shared/utils.js";
import { Errors, Models } from "../shared/enums.js";
import { mapAlunoRow } from "../aluno/utils.js";

export default {
  Query: {
    adminUser: async (_, args: { id: string }, context) => {
      const { id: user_id } = args;
      const numericId = decodeId(Models.AdminUser, user_id);

      const error = await checkExistenceAndOwnership(
        Models.AdminUser,
        numericId,
        context.user.id
      );

      if (error) {
        throw new Error(errorMessage(error));
      }

      const query = `
        SELECT u.* 
        FROM users u
        WHERE u.created_by = $1 
        AND u.id = $2
        AND u.status != 'archived'
        LIMIT 1
      `;

      const result = await pool.query(query, [context.user.id, numericId]);
      const rows = result.rows;

      if (!rows.length) {
        throw new Error(errorMessage(Errors.NotExist));
      }

      return mapUserRow(rows[0]);
    },
    adminUsers: async (_, args, context) => {
      requireAuth(context);

      const { first = 10, after, filter = {} } = args;
      const limit = first;
      const afterId = after
        ? Buffer.from(after, "base64").toString("utf-8")
        : null;

      let query = `
        SELECT u.* 
        FROM users u
        WHERE u.created_by = $1 
        AND u.status != 'archived'`;

      const params: any[] = [context.user.id];
      let paramIndex = 2;

      if (filter.status) {
        query += `AND u.status = $${paramIndex}`;
        params.push(filter.status.toLowerCase());
        paramIndex++;
      }

      if (filter.search && filter.search?.trim()) {
        query += ` AND (u.name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`;
        params.push(`%${filter.search}%`);
        paramIndex++;
      }

      if (afterId) {
        query += ` AND u.id > $${paramIndex}`;
        params.push(afterId);
        paramIndex++;
      }

      query += ` ORDER BY u.id ASC`;
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
        node: mapUserRow(row),
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
    addUser: async (
      _: any,
      body: { user: { name: string; email: string } },
      context
    ) => {
      requireAuth(context);
      const { name, email } = body.user;

      if (!name || !email) throw new Error("Pedido inválido");

      await checkDuplication(email, context.user.id);
      const registrationToken = randomBytes(32).toString("hex");
      const tokenExpiration = new Date();
      tokenExpiration.setDate(tokenExpiration.getDate() + 7);

      const result = await pool.query(
        `INSERT INTO users (
          email, 
          name, 
          role_id, 
          created_by, 
          status, 
          registration_token, 
          registration_token_expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          email,
          name,
          2,
          context.user.id,
          "pending",
          registrationToken,
          tokenExpiration,
        ]
      );

      const registrationLink = `${process.env.APP_URL}register/${registrationToken}`;

      sendEmail({
        to: email,
        subject: "Complete o registo",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1>Olá ${name}!</h1>
            <p>Bem vinda à plataforma!</p>
            <p>Clica no botão para definires a tua password e ativares a tua conta:</p>
            <a href="${registrationLink}" 
              style="display: inline-block; padding: 12px 24px; background-color: #4F46E5; 
                      color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
              Set Your Password
            </a>
            <p style="color: #999; font-size: 12px;">Este link expira em 7 dias.</p>
            <p><b>Bons treinos!</b></p>
          </div>
  `,
      }).catch((error) => {
        console.error("Failed to send registration email:", error);
      });

      return mapUserRow(result.rows[0]);
    },
    editUser: async (
      _: any,
      body: { user: { id: string; name: string; email: string } },
      context
    ) => {
      requireAuth(context);
      const { id, name, email } = body.user;
      if (!name || !id || !email) {
        throw new Error("Pedido inválido");
      }
      const numericId = decodeId(Models.AdminUser, id);
      const error = await checkExistenceAndOwnership(
        Models.AdminUser,
        numericId,
        context.user.id
      );
      if (error) {
        throw new Error(errorMessage(error));
      }

      await checkDuplication(name, context.user.id, numericId);

      const updateQuery = `
        UPDATE users 
        SET name = $1, email = $2, updated_at = NOW() 
        WHERE id = $3 
        RETURNING *
      `;

      const updateParams = [name, email, numericId];
      const result = await pool.query(updateQuery, updateParams);
      return mapUserRow(result.rows[0]);
    },
    setPassword: async (
      _: any,
      { token, password }: { token: string; password: string }
    ) => {
      if (!password || password.length < 6) {
        throw new Error("A palavra-passe deve ter pelo menos 6 caracteres");
      }

      const result = await pool.query(
        `SELECT * FROM users 
         WHERE registration_token = $1 
         AND registration_token_expires_at > NOW()
         AND status = 'pending'`,
        [token]
      );

      if (result.rows.length === 0) {
        throw new Error(
          "Link de registo inválido ou expirado. Por favor contacte um administrador."
        );
      }

      const user = result.rows[0];
      const hashedPassword = await bcrypt.hash(password, 10);

      await pool.query(
        `UPDATE users 
          SET password = $1,
           status = 'active',
           password_set_at = NOW(),
           registration_token = NULL,
           registration_token_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
        [hashedPassword, user.id]
      );

      return {
        success: true,
      };
    },
    resendRegistrationEmail: async (
      _: any,
      { userId }: { userId: string },
      context: any
    ) => {
      requireAuth(context);
      const numericId = decodeId(Models.AdminUser, userId);
      const result = await pool.query(
        `
        SELECT * 
        FROM users 
        WHERE id = $1 
        AND status = 'pending'`,
        [numericId]
      );

      if (result.rows.length === 0) {
        throw new Error("User não encontrado");
      }

      const user = result.rows[0];
      if (user.deactivated_at) {
        throw new Error("User está desativado");
      }

      const registrationToken = randomBytes(32).toString("hex");
      const tokenExpiration = new Date();
      tokenExpiration.setDate(tokenExpiration.getDate() + 7);

      await pool.query(
        `
        UPDATE users 
        SET registration_token = $1,
        registration_token_expires_at = $2,
        updated_at = NOW()
        WHERE id = $3`,
        [registrationToken, tokenExpiration, numericId]
      );

      const registrationLink = `${process.env.APP_URL}register/${registrationToken}`;

      sendEmail({
        to: user.email,
        subject: "Complete your registration",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1>Olá ${user.name}!</h1>
            <p>Bem vinda à plataforma!</p>
            <p>Clica no botão para definires a tua password e ativares a tua conta:</p>
            <a href="${registrationLink}" 
              style="display: inline-block; padding: 12px 24px; background-color: #4F46E5; 
                      color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
              Set Your Password
            </a>
            <p style="color: #999; font-size: 12px;">Este link expira em 7 dias.</p>
            <p><b>Bons treinos!</b></p>
          </div>
    `,
      }).catch((error) => {
        console.error("Failed to resend registration email:", error);
      });

      return {
        success: true,
      };
    },
    deleteUser: async (_: any, body: { id: string }, context) => {
      requireAuth(context);
      const { id } = body;
      const numericId = decodeId(Models.AdminUser, id);
      const error = await checkExistenceAndOwnership(
        Models.AdminUser,
        numericId,
        context.user.id
      );
      if (error) {
        throw new Error(errorMessage(error));
      }

      await pool.query(
        `
        UPDATE users 
        SET archived_at = CURRENT_TIMESTAMP, 
        updated_at = NOW(),
        status = 'archived'
        WHERE id = $1`,
        [numericId]
      );

      return id;
    },
    activateUser: async (_: any, body: { id: string }, context) => {
      requireAuth(context);
      const { id } = body;
      const numericId = decodeId(Models.AdminUser, id);
      const error = await checkExistenceAndOwnership(
        Models.AdminUser,
        numericId,
        context.user.id
      );
      if (error) {
        throw new Error(errorMessage(error));
      }

      const result = await pool.query(
        `
        UPDATE users 
        SET deactivated_at = NULL,
        updated_at = NOW(), 
        status = 'active'
        WHERE id = $1
        RETURNING *`,
        [numericId]
      );

      return mapUserRow(result.rows[0]);
    },
    deactivateUser: async (_: any, body: { id: string }, context) => {
      requireAuth(context);
      const { id } = body;
      const numericId = decodeId(Models.AdminUser, id);
      const error = await checkExistenceAndOwnership(
        Models.AdminUser,
        numericId,
        context.user.id
      );
      if (error) {
        throw new Error(errorMessage(error));
      }

      const result = await pool.query(
        `
        UPDATE users 
        SET deactivated_at = CURRENT_TIMESTAMP, updated_at = NOW(), status = 'deactivated'
        WHERE id = $1
        RETURNING *`,
        [numericId]
      );

      return mapUserRow(result.rows[0]);
    },
  },
  AdminUser: {
    photo: async (parent: any, _: any, context: any) => {
      const numericId = decodeId(Models.AdminUser, parent.id);

      const result = await pool.query(
        `SELECT photography_url, photography_key 
         FROM user_details 
         WHERE user_id = $1`,
        [numericId]
      );

      if (result.rows.length === 0) return null;

      return {
        url: result.rows[0].photography_url,
        key: result.rows[0].photography_key,
      };
    },
  },
  AdminUserWithProfile: {
    userDetails: async (parent: any, _: any, context: any) => {
      const numericId = decodeId(Models.AdminUser, parent.id);

      const result = await pool.query(
        `SELECT *
         FROM user_details 
         WHERE user_id = $1`,
        [numericId]
      );

      if (result.rows.length === 0) return null;

      return mapAlunoRow(result.rows[0]);
    },
  },
};
