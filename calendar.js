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

function isValidDate(dateString) {
  const regEx = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateString.match(regEx)) {
    return false;
  }

  const d = new Date(dateString);
  const dNum = d.getTime();
  if (!dNum && dNum !== 0) {
    return false;
  }

  return d.toISOString().slice(0, 10) === dateString;
}

app.get("/api/calendar/leaves/:day/:employeeId", rolesMiddleware(["admin","hr","employee"]), async function (req, res) {
  try {
    const day = req.params.day;
    const employeeId = req.params.employeeId;

    if (!isValidDate(day)) {
      return res.status(400).json({ error: 'Invalid date format for "day"' });
    } else if (typeof employeeId !== "string") {
      return res.status(400).json({ error: '"employeeId" must be a string' });
    }

    const params = {
      TableName: LEAVES_CALENDAR_TABLE,
      Key: {
        Day: day,
        EmployeeId: employeeId,
      },
    };

    const { Item } = await dynamoDbClient.send(new GetCommand(params));

    if (Item) {
      res.json(Item);
    } else {
      res
        .status(404)
        .json({
          error: "Could not find leave for the provided day and employeeId",
        });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not retrieve leave" });
  }
});

app.get("/api/calendar/holidays/:day", rolesMiddleware(["admin","hr","employee"]), async function (req, res) {
   try {
    const day = req.params.day;
    console.log(day);

    if (!isValidDate(day)) {
      return res.status(400).json({ error: 'Invalid date format for "day"' });
    } else {
      const params = {
        TableName: HOLIDAY_CALENDAR_TABLE,
        Key: {
          Day: day,
        },
      };

      const { Item } = await dynamoDbClient.send(new GetCommand(params));

      if (Item) {
        res.json(Item);
      } else {
        res
          .status(404)
          .json({ error: "Could not find holiday for the provided day" });
      }
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not retrieve holiday" });
  }
});

app.post("/api/calendar/holidays", rolesMiddleware(["admin","hr"]), async function (req, res) {
  const { day, desc } = req.body;

  if (typeof day !== "string" || typeof desc !== "string") {
    res.status(400).json({ error: '"day" and "desc" must be strings' });
    return;
  }

  const params = {
    TableName: HOLIDAY_CALENDAR_TABLE,
    Item: {
      Day: day,
      Desc: desc,
    },
  };

  try {
    await dynamoDbClient.send(new PutCommand(params));
    res.json({ day, desc });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not create holiday" });
  }
});

app.get("/api/calendar/holidays", rolesMiddleware(["admin","hr","employee"]), async function (req, res) {}
        
app.get("/api/calendar/leaves/:day/:employeeId", rolesMiddleware(["admin","hr","employee"]), async function (req, res) {}
        
app.get("/api/calendar/leaves/all", rolesMiddleware(["admin","hr"]), async function (req, res) {
   try {
      const params = {
          TableName: LEAVES_CALENDAR_TABLE,
      };

      const { Items } = await dynamoDbClient.send(new ScanCommand(params));

      if (Items && Items.length > 0) {
        const formattedItems = Items.map(item => {
          return {
              LeaveType: item.LeaveType.S,
              EmployeeId: item.EmployeeId.S,
              Day: item.Day.S,
          };
      });

      res.json(formattedItems);
      } else {
          res.status(404).json({ error: "No leaves found" });
      }
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Could not retrieve all leaves" });
  }
});
        
app.post("/api/calendar/leaves", rolesMiddleware(["admin","hr","employee"]), async function (req, res) {}





module.exports.handler = serverless(app);
