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

app.get("/api/users/:userId", rolesMiddleware(["admin","hr","employee"]), async function (req, res) {}

app.put("/api/users/edit/:userId", rolesMiddleware(["admin"]), async function (req, res) {
  const { name, email, role, username, contactNo, birthday, joinday, permissions } = req.body;
  const userId = req.params.userId;

  // Validate input data
  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof role !== "string" ||
    typeof username !== "string" ||
    typeof contactNo !== "string" ||
    typeof birthday !== "string" ||
    typeof joinday !== "string" ||
    !Array.isArray(permissions)
  ) {
    res.status(400).json({ error: "Invalid input data" });
    return;
  }

  // Check if the userId exists in the EMPLOYEES_TABLE
  const userParams = {
    TableName: EMPLOYEES_TABLE,
    Key: {
      userId: userId,
    },
  };

  try {
    const { Item: user } = await dynamoDbClient.send(new GetCommand(userParams));

    if (!user) {
      res.status(400).json({ error: "User not found with the provided userId" });
      return;
    }

    // Update the specified fields
    const updateParams = {
      TableName: EMPLOYEES_TABLE,
      Key: {
        userId: userId,
      },
      UpdateExpression: "SET #name = :name, #email = :email, #role = :role, #username = :username, #contactNo = :contactNo, #birthday = :birthday, #joinday = :joinday, #permissions = :permissions",
      ExpressionAttributeNames: {
        "#name": "name",
        "#email": "email",
        "#role": "role",
        "#username": "username",
        "#contactNo": "contactNo",
        "#birthday": "birthday",
        "#joinday": "joinday",
        "#permissions": "permissions",
      },
      ExpressionAttributeValues: {
        ":name": name,
        ":email": email,
        ":role": role,
        ":username": username,
        ":contactNo": contactNo,
        ":birthday": birthday,
        ":joinday": joinday,
        ":permissions": permissions,
      },
    };

    await dynamoDbClient.send(new UpdateCommand(updateParams));

    res.json({
      userId,
      name,
      email,
      role,
      username,
      contactNo,
      birthday,
      joinday,
      permissions,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not update user" });
  }
});

app.get("/api/users/employees/all", rolesMiddleware(["admin"]), async function (req, res) {
  try {
    const adminUserId = req.user.userId;

    // Retrieve the admin's company information from the database
    const adminParams = {
      TableName: ADMINS_TABLE,
      Key: {
        userId: adminUserId,
      },
    };

    const { Item: admin } = await dynamoDbClient.send(new GetCommand(adminParams));

    if (!admin || !admin.companyId) {
      res.status(400).json({ error: "Admin information not found or missing companyId" });
      return;
    }

    // Retrieve all employees for the admin's company
    const employeeParams = {
      TableName: EMPLOYEES_TABLE,
      FilterExpression: "#companyId = :companyId AND #role = :role",
      ExpressionAttributeNames: {
        "#companyId": "companyId",
        "#role": "role",
      },
      ExpressionAttributeValues: {
        ":companyId": admin.companyId,
        ":role": "employee",
      },
    };

    const { Items: employeePersons } = await dynamoDbClient.send(new ScanCommand(employeeParams));

    res.json(employeePersons);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Could not get employee persons" });
  }
});

app.get("/api/users/supervisors/all", rolesMiddleware(["admin"]), async function (req, res) {
  try {
    const adminUserId = req.user.userId;

    // Retrieve the admin's company information from the database
    const adminParams = {
      TableName: ADMINS_TABLE,
      Key: {
        userId: adminUserId,
      },
    };

    const { Item: admin } = await dynamoDbClient.send(new GetCommand(adminParams));

    if (!admin || !admin.companyId) {
      res.status(400).json({ error: "Admin information not found or missing companyId" });
      return;
    }

    // Retrieve all supervisors for the admin's company
    const supervisorParams = {
      TableName: EMPLOYEES_TABLE,
      FilterExpression: "#companyId = :companyId AND #role = :role",
      ExpressionAttributeNames: {
        "#companyId": "companyId",
        "#role": "role",
      },
      ExpressionAttributeValues: {
        ":companyId": admin.companyId,
        ":role": "supervisor",
      },
    };

    const { Items: supervisorPersons } = await dynamoDbClient.send(new ScanCommand(supervisorParams));

    res.json(supervisorPersons);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Could not get supervisor persons" });
  }
});

app.get("/api/users/hr/all", rolesMiddleware(["admin"]), async function (req, res) {}

app.post("/api/users/create-user", rolesMiddleware(["admin"]), async function (req, res) {
   const { name, email, password, role, username, contactNo, birthday, joinday, permissions } = req.body;

  // Validate input data
  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof password !== "string" ||
    typeof role !== "string" ||
    typeof username !== "string" ||
    typeof contactNo !== "string" ||
    typeof birthday !== "string" ||
    typeof joinday !== "string" ||
    !Array.isArray(permissions)
  ) {
    res.status(400).json({ error: "Invalid input data" });
    return;
  }

  const adminUserId = req.user.userId; // Assuming you have the authenticated user info in req.user

  // Retrieve the admin's company information from the database
  const adminParams = {
    TableName: ADMINS_TABLE, // Change this table name accordingly
    Key: {
      userId: adminUserId,
    },
  };

  try {
    const { Item: admin } = await dynamoDbClient.send(new GetCommand(adminParams));

    if (!admin || !admin.companyId) {
      res.status(400).json({ error: "Admin information not found or missing companyId" });
      return;
    }

    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);

    const params = {
      TableName: EMPLOYEES_TABLE, // Assuming EMPLOYEES_TABLE is used for HR users
      Item: {
        userId: userId,
        name: name,
        email: email,
        password: hashedPassword,
        role: role,
        username: username,
        contactNo: contactNo,
        birthday: birthday,
        joinday: joinday,
        permissions: permissions,
        companyId: admin.companyId, // Include the companyId from the admin
      },
    };

    await dynamoDbClient.send(new PutCommand(params));
    res.json({
      userId,
      name,
      email,
      role,
      username,
      contactNo,
      birthday,
      joinday,
      permissions,
      companyId: admin.companyId,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Could not create user" });
  }
});


app.post("/api/users/company/create", rolesMiddleware(["superadmin"]), async function (req, res) {}

app.post("/api/users/create-admin", rolesMiddleware(["superadmin"]), async function (req, res) {}

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
