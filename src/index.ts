import { ApolloServer } from "@apollo/server";
import express from "express";
import { JWT_SECRET } from "./database.js";
import jwt from "jsonwebtoken";
import { loadFilesSync } from "@graphql-tools/load-files";
import path from "path";
import { fileURLToPath } from "url";
import { mergeResolvers, mergeTypeDefs } from "@graphql-tools/merge";
import { writeFileSync } from "fs";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { printSchema } from "graphql";
import dotenv from "dotenv";
import cors from "cors";
import graphqlUploadExpress from "graphql-upload/graphqlUploadExpress.mjs";

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const typesArray = loadFilesSync(path.join(__dirname, "./**/*.graphql"));
const resolversArray = loadFilesSync(
  path.join(__dirname, "./**/*.resolvers.js")
);

const typeDefs = mergeTypeDefs(typesArray);
const resolvers = mergeResolvers(resolversArray);

const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});

const sdl = printSchema(schema);
writeFileSync(path.join(process.cwd(), "schema.graphql"), sdl);

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(graphqlUploadExpress({ maxFileSize: 10000000 }));

const server = new ApolloServer({
  schema,
});

await server.start();

app.post(
  "/graphql",
  async (req, res, next) => {
    const token = req.headers.authorization || "";
    let user = null;
    if (token) {
      try {
        const cleanToken = token.replace("Bearer ", "");
        user = jwt.verify(cleanToken, JWT_SECRET);
      } catch (error) {
        user = null;
      }
    }
    req.user = user;
    next();
  },
  async (req, res) => {
    const { query, variables } = req.body;
    const result = await server.executeOperation(
      { query, variables },
      { contextValue: { user: req.user, req } }
    );
    if (result.body.kind === "single") {
      res.json(result.body.singleResult);
    } else {
      res.json(result.body);
    }
  }
);

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`🚀 Server ready at http://localhost:${PORT}/graphql`);
});
