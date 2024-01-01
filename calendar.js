require('dotenv').config();

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { ScanCommand } = require("@aws-sdk/client-dynamodb");

const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");
const express = require("express");
const serverless = require("serverless-http");
const { authenticateToken } = require("./middlewares/authMiddleware");
const { rolesMiddleware } = require("./middlewares/rolesMiddleware");


const app = express();

const HOLIDAY_CALENDAR_TABLE = process.env.HOLIDAY_CALENDAR_TABLE;
const LEAVES_CALENDAR_TABLE = process.env.LEAVES_CALENDAR_TABLE;

const client = new DynamoDBClient();
const dynamoDbClient = DynamoDBDocumentClient.from(client);

const JWT_SECRET = process.env.JWT_SECRET; 
app.use(express.json());

app.use((req, res, next) => {
  if (req.path !== "/api/users/login") {
    authenticateToken(req, res, next);
  } else {
    next();
  }
});


module.exports.handler = serverless(app);
