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
const errors = require('./errors');

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

app.get("/api/users/:userId", rolesMiddleware(["admin","hr","employee"]), async function (req, res) { const params = {
    TableName: EMPLOYEES_TABLE,
    Key: {
      userId: req.params.userId,
    },
  };

  try {
    const { Item } = await dynamoDbClient.send(new GetCommand(params));
    if (Item) {
      const { userId, name, email, role } = Item;
      res.json({ userId, name, email, role });
    } else {
      res.status(404).json({ error: errors.userNotFound });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: errors.getUsersError });
  }});

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
    res.status(400).json({ error: errors.invalidInputData });
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
      res.status(400).json({ error: errors.userNotFound });
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
    res.status(500).json({ error: errors.updateUserError });
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
      res.status(400).json({ error: errors.adminCompanyInfoNotFound });
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
    res.status(500).json({ error: errors.getEmployeePersonsError });
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
      res.status(400).json({ error: errors.adminCompanyInfoNotFound });
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
    res.status(500).json({ error: errors.getSupervisorPersonsError });
  }
});

app.get("/api/users/hr/all", rolesMiddleware(["admin"]), async function (req, res) { try {
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
      res.status(400).json({ error: errors.adminCompanyInfoNotFound });
      return;
    }

    // Retrieve all HR persons for the admin's company
    const hrParams = {
      TableName: EMPLOYEES_TABLE,
      FilterExpression: "#companyId = :companyId AND #role = :role",
      ExpressionAttributeNames: {
        "#companyId": "companyId",
        "#role": "role",
      },
      ExpressionAttributeValues: {
        ":companyId": admin.companyId,
        ":role": "hr",
      },
    };


    
    const { Items: hrPersons } = await dynamoDbClient.send(new ScanCommand(hrParams));
    
    res.json(hrPersons);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: errors.getHRPersonsError });
  }});

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
    res.status(400).json({ error: errors.invalidInputData });
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
      res.status(400).json({ error: errors.adminCompanyInfoNotFound });
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
    res.status(500).json({ error: errors.createUserError});
  }
});


app.post("/api/users/company/create", rolesMiddleware(["superadmin"]), async function (req, res) {
   const { companyName, companyLocation, companyEmail } = req.body;

  // Validate input data
  if (
    typeof companyName !== "string" ||
    typeof companyLocation !== "string" ||
    typeof companyEmail !== "string"
  ) {
    res.status(400).json({ error: errors.invalidInputData });
    return;
  }

  const companyId = uuidv4(); // Generate a unique companyId

  const params = {
    TableName: COMPANY_TABLE,
    Item: {
      companyId: companyId,
      companyName: companyName,
      companyLocation: companyLocation,
      companyEmail: companyEmail,
    },
  };

  try {
    await dynamoDbClient.send(new PutCommand(params));
    res.json({ companyId, companyName, companyLocation, companyEmail });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: errors.createCompanyError });
  }
});

app.post("/api/users/create-admin", rolesMiddleware(["superadmin"]), async function (req, res) {
    const { name, email, contactNo, username, password, companyId } = req.body;

  // Validate input data
  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    (typeof contactNo !== "string" && typeof contactNo !== "number") ||
    typeof username !== "string" ||
    (typeof password !== "string" && typeof password !== "number") ||
    typeof companyId !== "string"
  ) {
    res.status(400).json({ error: errors.invalidInputData });
    return;
  }

  // Check if the companyId exists in COMPANY_TABLE
  const companyParams = {
    TableName: COMPANY_TABLE,
    Key: {
      companyId: companyId,
    },
  };

  try {
    const { Item: company } = await dynamoDbClient.send(new GetCommand(companyParams));

    if (!company) {
      res.status(400).json({ error: errors.companyNotFound });
      return;
    }

    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash(password.toString(), 10); // Convert password to string before hashing

    // Company found, include companyId and companyName in the admin data
    const params = {
      TableName: ADMINS_TABLE,
      Item: {
        userId: userId,
        name: name,
        email: email,
        contactNo: contactNo.toString(), // Use contactNo instead of contactno
        username: username,
        password: hashedPassword,
        role: "admin",
        companyId: companyId,
        companyName: company.companyName, // Include the company name
      },
    };

    await dynamoDbClient.send(new PutCommand(params));
    res.json({ userId, name, email, contactNo, username, companyId, companyName: company.companyName, role: "admin" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: errors.createUserError });
  }
});

app.post("/api/users/login", async function (req, res) {
  const { email, password } = req.body;

  const paramsAdmins = {
    TableName: ADMINS_TABLE,
    FilterExpression: "email = :email",
    ExpressionAttributeValues: {
      ":email": email,
    },
  };

  const paramsEmployees = {
    TableName: EMPLOYEES_TABLE,
    FilterExpression: "email = :email",
    ExpressionAttributeValues: {
      ":email": email,
    },
  };

  try {
    const { Items: adminItems } = await dynamoDbClient.send(new ScanCommand(paramsAdmins));
    const { Items: employeeItems } = await dynamoDbClient.send(new ScanCommand(paramsEmployees));

    const user = adminItems[0] || employeeItems[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: errors.invalidCredentials });
    }

    console.log(user);

    // Set the expiration time for the token (e.g., 1 hour from now) in milliseconds
    const expiresInMilliseconds = 3600 * 1000; // 1 hour in milliseconds
    const expirationTime = Date.now() + expiresInMilliseconds;

    const token = jwt.sign({
      userId: user.userId,
      role: user.role,
      exp: expirationTime, // Set the expiration time in the payload
    }, JWT_SECRET);

    res.json({
      token,
      role: user.role,
      userId: user.userId,
      expiresIn: expiresInMilliseconds, // Include the expiration time in the response
    });

  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: errors.getUsersError });
  }
});



module.exports.handler = serverless(app);
