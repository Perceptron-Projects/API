require('dotenv').config();
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const express = require("express");
const serverless = require("serverless-http");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const { authenticateToken } = require("./middlewares/authMiddleware");
const { rolesMiddleware } = require("./middlewares/rolesMiddleware");

const app = express();

const ADMINS_TABLE = process.env.ADMINS_TABLE;
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE;
const COMPANY_TABLE = process.env.COMPANY_TABLE;

const JWT_SECRET = process.env.JWT_SECRET; 

const client = new DynamoDBClient();
const dynamoDbClient = DynamoDBDocumentClient.from(client);

app.use(express.json());


app.use((req, res, next) => {
  if (req.path !== "/api/users/login") {
    authenticateToken(req, res, next);
  } else {
    next();
  }
});



app.post("/api/users/login", async function (req, res) {
  const { email, password, role } = req.body;

  const tableName = role === "admin" || role === "superadmin" ? ADMINS_TABLE : EMPLOYEES_TABLE;

  const params = {
    TableName: tableName,
    FilterExpression: "email = :email",
    ExpressionAttributeValues: {
      ":email": email,
    },
  };

  let user;
  try {
    const { Items } = await dynamoDbClient.send(new ScanCommand(params));
    console.log(Items);
    user = Items[0];
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Could not get users" });
  }

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  console.log(user);
  const token = jwt.sign({ userId: user.userId, role: user.role }, JWT_SECRET);
  res.json({ token, role: user.role });
});


module.exports.handler = serverless(app);
