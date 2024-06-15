
const serverless = require('serverless-http');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const router = express.Router();


module.exports.handler = serverless(app);
