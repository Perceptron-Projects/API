require("dotenv").config();

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { ScanCommand } = require("@aws-sdk/client-dynamodb");

const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const express = require("express");
const serverless = require("serverless-http");
const { authenticateToken } = require("./middlewares/authMiddleware");
const { rolesMiddleware } = require("./middlewares/rolesMiddleware");
const errors = require("./config/errors");
const { v4: uuidv4 } = require("uuid");
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

app.get(
  "/api/calendar/leaves/:day/:employeeId",
  rolesMiddleware(["admin", "hr", "employee"]),
  async function (req, res) {
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
        res.status(404).json({
          error: errors.leaveNotFound,
        });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: errors.retrieveLeaveError });
    }
  }
);

app.get(
  "/api/calendar/holidays/:day",
  rolesMiddleware(["admin", "hr", "employee"]),
  async function (req, res) {
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
          res.status(404).json({ error: errors.holidayNotFound });
        }
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: errors.retrieveHolidayError });
    }
  }
);

// calender event api

app.post(
  "/api/calendar/holidays",
  rolesMiddleware(["admin", "hr"]),
  async function (req, res) {
    if (!req.body) {
      res.status(400).json({ error: "data must be provided" });
      return;
    }
    const holidayId = uuidv4();

    const params = {
      TableName: HOLIDAY_CALENDAR_TABLE,
      Item: {
        holidayId: holidayId,
        ...req.body,
      },
    };

    try {
      await dynamoDbClient.send(new PutCommand(params));
      res.json(req.body);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: errors.createHolidayError });
    }
  }
);

app.get(
  "/api/calendar/holidays",
  rolesMiddleware(["admin", "hr", "employee", "supervisor"]),
  async function (req, res) {
    const params = {
      TableName: HOLIDAY_CALENDAR_TABLE,
    };

    try {
      const { Items } = await dynamoDbClient.send(new ScanCommand(params));

      const formattedItems = Items.map((item) => {
        return {
          id: item.holidayId.S,
          end: item.end.S,
          start: item.start.S,
          type: item.type.S,
          title: item.title.S,
          markedBy: item.markedBy.S,
        };
      });

      res.json(formattedItems);
    } catch (error) {
      console.log(error);
      res.status(500).json({ error: errors.retrieveAllHolidaysError });
    }
  }
);

app.delete(
  "/api/calendar/holidays/:holidayId",
  rolesMiddleware(["admin", "hr"]),
  async function (req, res) {
    const holidayId = req.params.holidayId;
    const params = {
      TableName: HOLIDAY_CALENDAR_TABLE,
      Key: {
        holidayId: holidayId,
      },
    };
    try {
      await dynamoDbClient.send(new DeleteCommand(params));
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: errors.deleteHolidayError });
    }
  }
);

app.put("/api/calendar/holidays/:holidayId", async function (req, res) {
  const holidayId = req.params.holidayId;
  const params = {
    TableName: HOLIDAY_CALENDAR_TABLE,
    Key: {
      holidayId: holidayId,
    },
    UpdateExpression:
      "SET #start = :start, #end = :end, #title = :title, #type = :type",
    ExpressionAttributeNames: {
      "#start": "start",
      "#end": "end",
      "#title": "title",
      "#type": "type",
    },
    ExpressionAttributeValues: {
      ":start": req.body.start,
      ":end": req.body.end,
      ":title": req.body.title,
      ":type": req.body.type,
      //req.body.markedBy
    },
  };

  try {
    await dynamoDbClient.send(new UpdateCommand(params));
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: errors.updateHolidayError });
  }
});

app.get(
  "/api/calendar/leaves/:day/:employeeId",
  rolesMiddleware(["admin", "hr", "employee"]),
  async function (req, res) {
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
        res.status(404).json({
          error: errors.leaveNotFound,
        });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: errors.retrieveLeaveError });
    }
  }
);

app.get(
  "/api/calendar/leaves/all",
  rolesMiddleware(["admin", "hr"]),
  async function (req, res) {
    try {
      const params = {
        TableName: LEAVES_CALENDAR_TABLE,
      };

      const { Items } = await dynamoDbClient.send(new ScanCommand(params));

      if (Items && Items.length > 0) {
        const formattedItems = Items.map((item) => {
          return {
            LeaveType: item.LeaveType.S,
            EmployeeId: item.EmployeeId.S,
            Day: item.Day.S,
          };
        });

        res.json(formattedItems);
      } else {
        res.status(404).json({ error: errors.noLeavesFound });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: errors.retrieveAllLeavesError });
    }
  }
);

app.post(
  "/api/calendar/leaves",
  rolesMiddleware(["admin", "hr", "employee"]),
  async function (req, res) {
    const { day, empId, leaveType } = req.body;

    if (typeof day !== "string") {
      res.status(400).json({ error: '"day" must be a string' });
    } else if (typeof empId !== "string") {
      res.status(400).json({ error: '"empId" must be a string' });
    } else if (typeof leaveType !== "string") {
      res.status(400).json({ error: '"leaveType" must be a string' });
    }

    const params = {
      TableName: LEAVES_CALENDAR_TABLE,
      Item: {
        Day: day,
        EmployeeId: empId,
        LeaveType: leaveType,
      },
    };

    try {
      await dynamoDbClient.send(new PutCommand(params));
      res.json({ day, empId, leaveType });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: errors.createLeaveError });
    }
  }
);

module.exports.handler = serverless(app);
