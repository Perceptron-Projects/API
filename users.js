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
const { isWithinRadius } = require("./utils/geoFencing");
const { uploadImage } = require("./utils/imageUpload");

const app = express();

const ADMINS_TABLE = process.env.ADMINS_TABLE;
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE;
const COMPANY_TABLE = process.env.COMPANY_TABLE;
const ATTENDANCE_TABLE = process.env.ATTENDANCE_TABLE;
const JWT_SECRET = process.env.JWT_SECRET; 


const client = new DynamoDBClient();
const dynamoDbClient = DynamoDBDocumentClient.from(client);

app.use(express.json({ limit: "50mb" }));


app.use((req, res, next) => {
  if (req.path !== "/api/users/login") {
    authenticateToken(req, res, next);
  } else {
    next();
  }
});

app.get("/api/users/isWithinRadius/:companyId", rolesMiddleware(["admin","hr","employee"]), async function (req, res) {
  try {
    const { userLat, userLon } = req.query;
    const companyId = req.params.companyId;

    // Validate input data
    if (!companyId || !userLat || !userLon) {
      res.status(400).json({ error: "Missing required parameters" });
      return;
    }

    // Fetch company details from the COMPANY_TABLE
    const companyParams = {
      TableName: COMPANY_TABLE,
      Key: {
        companyId: companyId,
      },
    };

    const { Item: company } = await dynamoDbClient.send(new GetCommand(companyParams));

    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    // Extract company details
    const { latitude: companyLat, longitude: companyLon, radiusFromCenterOfCompany } = company;

    // Check if the user is within the predefined radius
    const withinRadius = isWithinRadius(parseFloat(userLat), parseFloat(userLon), companyLat, companyLon, radiusFromCenterOfCompany);

    res.json({ withinRadius });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error checking if the user is within the radius" });
  }
});
app.post("/api/users/attendance/mark", rolesMiddleware(["hr","employee"]), async function (req, res) {
  try {
    const { employeeId, companyId, time, isCheckedIn, isCheckedOut, isWorkFromHome } = req.body;

    // Validate input data
    if (!employeeId || !companyId || !time || isCheckedIn === undefined || isCheckedOut === undefined || isWorkFromHome === undefined) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Check if the employee exists
    const employeeParams = {
      TableName: EMPLOYEES_TABLE,
      Key: { userId: employeeId },
    };

    const { Item: employee } = await dynamoDbClient.send(new GetCommand(employeeParams));

    if (!employee || employee.companyId !== companyId) {
      return res.status(404).json({ error: "Employee not found" });
    }

    // Fetch existing attendance record for the day
    const today = new Date().toISOString().split('T')[0];
    const attendanceId = employeeId+ today;
    const attendanceParams = {
      TableName: ATTENDANCE_TABLE,
      Key: { date: today, attendanceId: attendanceId }
    };

    let { Item: existingAttendance } = await dynamoDbClient.send(new GetCommand(attendanceParams));

    // If a check-in is marked
    if (isCheckedIn) {
      if (existingAttendance && existingAttendance.isCheckedIn) {
        return res.status(400).json({ error: "You are already checked in" });
      }
      // If a check-out is not marked yet or the user hasn't checked in yet, create a new record for check-in
      if (!existingAttendance || !existingAttendance.isCheckedOut) {
        const checkInRecord = {
          attendanceId: attendanceId,
          companyId,
          date: today,
          time,
          isCheckedIn: true,
          isCheckedOut: false,
          isWorkFromHome
        };
        await dynamoDbClient.send(new PutCommand({ TableName: ATTENDANCE_TABLE, Item: checkInRecord }));
        return res.json({ message: "Check-in marked successfully" });
      }
    }

    // If a check-out is marked
    if (isCheckedOut) {
      if (!existingAttendance || !existingAttendance.isCheckedIn) {
        return res.status(400).json({ error: "Cannot mark check-out without a previous check-in for the day" });
      }
      if (existingAttendance.isCheckedOut) {
        return res.status(400).json({ error: "You are already checked out" });
      }
      // Update the existing record for check-out
      existingAttendance.isCheckedOut = true;
      existingAttendance.time = time;
      await dynamoDbClient.send(new PutCommand({ TableName: ATTENDANCE_TABLE, Item: existingAttendance }));
      return res.json({ message: "Check-out marked successfully" });
    }

    return res.status(400).json({ error: "Invalid request" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error marking attendance" });
  }
});


app.get("/api/users/attendance/checkForTheDay/:employeeId", rolesMiddleware(["hr", "employee"]), async function (req, res) {
  try {
    const { employeeId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    const attendanceId = employeeId + today;

    // Fetch existing attendance record for the day
    const attendanceParams = {
      TableName: ATTENDANCE_TABLE,
      Key: { date: today, attendanceId: attendanceId }
    };

    const { Item: existingAttendance } = await dynamoDbClient.send(new GetCommand(attendanceParams));

    if (!existingAttendance) {
      console.log("Attendance record not found");
      return res.status(404).json({ error: "Attendance record not found" });
    }

    return res.json(existingAttendance);
  } catch (error) {
    console.error("Error fetching attendance details:", error);
    return res.status(500).json({ error: "Error fetching attendance details" });
  }
});


app.get("/api/users/:userId", rolesMiddleware(["admin","hr","employee"]), async function (req, res) { 
  const params = {
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

app.get("/api/users/admins/all", rolesMiddleware(["superadmin"]), async function (req, res) {
  try {
    // Retrieve all admins
    const adminParams = {
      TableName: ADMINS_TABLE,
      FilterExpression: "#role = :role",
      ExpressionAttributeNames: {
        "#role": "role",
      },
      ExpressionAttributeValues: {
        ":role": "admin",
      },
    };

    const { Items: adminPersons } = await dynamoDbClient.send(new ScanCommand(adminParams));
    res.json(adminPersons);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: errors.getAdminPersonsError });
  }
});

app.get("/api/users/admins/:id", rolesMiddleware(["superadmin"]), async function (req, res) {
  try {
    const adminId = req.params.id;
    const adminParams = {
      TableName: ADMINS_TABLE,
      Key: {
        userId: adminId,
      },
    };

    const { Item: admin } = await dynamoDbClient.send(new GetCommand(adminParams));


  
    res.json(admin);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error fetching admin by ID" });
  }
});

app.get("/api/users/company/:id", rolesMiddleware(["superadmin"]), async function (req, res) {
  try {
    const companyId = req.params.id;
    const companyParams = {
      TableName: COMPANY_TABLE,
      Key: {
        companyId: companyId,
      },
    };

    const { Item: company } = await dynamoDbClient.send(new GetCommand(companyParams));

    res.json(company);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error fetching company by ID" });
  }
}
);

app.get("/api/users/companies/all", rolesMiddleware(["superadmin"]), async function (req, res) {
  

  try {
    // Retrieve all companies
    const params = {
      TableName: COMPANY_TABLE,
    };

    const { Items: companies } = await dynamoDbClient.send(new ScanCommand(params));

    res.json(companies);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: errors.getCompaniesError });
  }
});

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

  const adminUserId = req.user.userId; 
  // Retrieve the admin's company information from the database
  const adminParams = {
    TableName: ADMINS_TABLE,  
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
      TableName: EMPLOYEES_TABLE, 
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
  const { companyName, email, contactNo, longitude, latitude, radiusFromCenterOfCompany } = req.body;

  if (
    typeof companyName !== "string" ||
    typeof email !== "string" ||
    typeof contactNo !== "string" ||
    typeof longitude !== "string" ||
    typeof latitude !== "string" ||
    typeof radiusFromCenterOfCompany !== "string"
  ) {
    
    res.status(400).json({ error: errors.invalidInputData });
    return;
  }
  
  let imageUrl = '';
  if (req.body.image) {
    try {
      // Await the result of the uploadImage function
      const uploadResult = await uploadImage(req.body.image);
      imageUrl = uploadResult.imageUrl;
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: "Image upload failed" });
      return;
    }
  }
  
  const companyId = uuidv4(); // Generate a unique companyId
  
  const params = {
    TableName: COMPANY_TABLE,
    Item: {
      companyId: companyId,
      companyName: companyName,
      location: {
        longitude: longitude,
        latitude: latitude,
      },
      companyEmail: email,
      contactNo: contactNo,
      companyImageUrl: imageUrl || "https://media.istockphoto.com/id/908578348/vector/business-building-illustration.jpg?s=612x612&w=0&k=20&c=thg6Bom79dCRo8pMV3fo7p-8b7m1p-EdLZZPKYpXYvg=",
      radiusFromCenterOfCompany: radiusFromCenterOfCompany,
    },
  };
  
  try {
    await dynamoDbClient.send(new PutCommand(params));
    res.json({
      companyId,
      companyName,
      location: {
        longitude,
        latitude,
      },
      companyEmail: email,
      contactNo,
      companyImageUrl: imageUrl,
      radiusFromCenterOfCompany,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: errors.createCompanyError });
  }
  
});

app.post("/api/users/create-admin", rolesMiddleware(["superadmin"]), async function (req, res) {
  const { firstName, lastName, companyData, email, contactNo } = req.body;

  // Validate input data
  if (
    typeof firstName !== "string" ||
    typeof lastName !== "string" ||
    typeof email !== "string" ||
    (typeof contactNo !== "string" && typeof contactNo !== "number") ||
    typeof companyData !== "object"
  ) {
    res.status(400).json({ error: errors.invalidInputData });
    return;
  }

  let imageUrl = '';

  if (req.body.image) {
    try {
      // Await the result of the uploadImage function
      const uploadResult = await uploadImage(req.body.image);
      console.log(uploadResult);
      imageUrl = uploadResult.imageUrl;
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: "Image upload failed" });
      return;
    }
  }

  // Extract company data
  const { companyId, companyName } = companyData;

  // Check if the companyId exists in COMPANY_TABLE
  const companyParams = {
    TableName: COMPANY_TABLE,
    Key: {
      companyId: companyId,
    },
  };

  const { Item: company } = await dynamoDbClient.send(new GetCommand(companyParams));

  if (!company) {
    res.status(400).json({ error: errors.companyNotFound });
    return;
  }

  const userId = uuidv4();

  const password = bcrypt.hashSync("admin123", 10);

  // Company found, include companyId and companyName in the admin data
  const params = {
    TableName: ADMINS_TABLE,
    Item: {
      userId: userId,
      firstName: firstName,
      lastName: lastName,
      email: email,
      contactNo: contactNo.toString(),
      role: "admin",
      companyId: companyId,
      companyName: companyName,
      password: password,
      adminImageUrl: imageUrl || "https://www.svgrepo.com/show/384674/account-avatar-profile-user-11.svg",
    },
  };

  try {
    await dynamoDbClient.send(new PutCommand(params));
    res.json({
      userId,
      firstName,
      lastName,
      email,
      contactNo,
      companyId,
      companyName,
      role: "admin",
      adminImageUrl: imageUrl,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: errors.createUserError });
  }
});

app.patch("/api/users/admins/:id", rolesMiddleware(["superadmin"]), async function (req, res) {
  try {
    const adminId = req.params.id;
    const { firstName, lastName, email, contactNo, username, companyId, companyName } = req.body;
    // Validate input data
    if (
      typeof firstName !== "string" ||
      typeof lastName !== "string" ||
      typeof email !== "string" ||
      (typeof contactNo !== "string" && typeof contactNo !== "number") ||
      typeof username !== "string" ||
      typeof companyId !== "string" ||
      typeof companyName !== "string"
    ) {
      res.status(400).json({ error: errors.invalidInputData });
      return;
    }

    let imageUrl = '';

    if (req.body.image) {
      try {
        // If image is provided, upload it
        const uploadResult = await uploadImage(req.body.image);
        imageUrl = uploadResult.imageUrl;
      } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Image upload failed" });
        return;
      }
    }

    // Check if the admin exists
    const adminParams = {
      TableName: ADMINS_TABLE,
      Key: {
        userId: adminId,
      },
    };

    const { Item: existingAdmin } = await dynamoDbClient.send(new GetCommand(adminParams));

    if (!existingAdmin) {
      res.status(404).json({ error: "Admin not found" });
      return;
    }

    // Update admin data
    const updatedAdmin = {
      ...existingAdmin,
      firstName: firstName || existingAdmin.firstName,
      lastName: lastName || existingAdmin.lastName,
      email: email || existingAdmin.email,
      contactNo: contactNo.toString() || existingAdmin.contactNo,
      username: username || existingAdmin.username,
      companyId: companyId || existingAdmin.companyId,
      companyName: companyName || existingAdmin.companyName,
      adminImageUrl: imageUrl || existingAdmin.adminImageUrl || "https://www.svgrepo.com/show/384674/account-avatar-profile-user-11.svg",
    };

    const updateParams = {
      TableName: ADMINS_TABLE,
      Key: {
        userId: adminId,
      },
      UpdateExpression: "SET firstName = :firstName, lastName = :lastName, email = :email, contactNo = :contactNo, username = :username, companyId = :companyId, companyName = :companyName, adminImageUrl = :adminImageUrl",
      ExpressionAttributeValues: {
        ":firstName": updatedAdmin.firstName,
        ":lastName": updatedAdmin.lastName,
        ":email": updatedAdmin.email,
        ":contactNo": updatedAdmin.contactNo,
        ":username": updatedAdmin.username,
        ":companyId": updatedAdmin.companyId,
        ":companyName": updatedAdmin.companyName,
        ":adminImageUrl": updatedAdmin.adminImageUrl,
      },
      ReturnValues: "ALL_NEW",
    };

    const { Attributes: updatedAttributes } = await dynamoDbClient.send(new UpdateCommand(updateParams));

    res.json(updatedAttributes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error updating admin" });
  }
});

app.patch("/api/users/company/:id", rolesMiddleware(["superadmin"]), async function (req, res) {
  try {
    const companyId = req.params.id;
    const { companyName, latitude, email, contactNo, longitude, radiusFromCenterOfCompany } = req.body;

    // Validate input data
    if (
      typeof companyName !== "string" ||
      typeof latitude !== "string" ||
      typeof email !== "string" ||
      typeof contactNo !== "string" ||
      typeof longitude !== "string" ||
      typeof radiusFromCenterOfCompany !== "string"
    ) {
      res.status(400).json({ error: errors.invalidInputData });
      return;
    }

    let imageUrl = '';
    if (req.body.image) {
      try {
        const uploadResult = await uploadImage(req.body.image);
        imageUrl = uploadResult.imageUrl;
      } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Image upload failed" });
        return;
      }
    }

    // Check if the company exists
    const companyParams = {
      TableName: COMPANY_TABLE,
      Key: {
        companyId: companyId,
      },
    };

    const { Item: existingCompany } = await dynamoDbClient.send(new GetCommand(companyParams));

    if (!existingCompany) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    // Update company data
    const updatedCompany = {
      ...existingCompany,
      companyName: companyName || existingCompany.companyName,
      latitude: latitude || existingCompany.latitude,
      email: email || existingCompany.email,
      contactNo: contactNo || existingCompany.contactNo,
      longitude: longitude || existingCompany.longitude,
      radiusFromCenterOfCompany: radiusFromCenterOfCompany || existingCompany.radiusFromCenterOfCompany,
      companyImageUrl: imageUrl || existingCompany.companyImageUrl || "https://media.istockphoto.com/id/908578348/vector/business-building-illustration.jpg?s=612x612&w=0&k=20&c=thg6Bom79dCRo8pMV3fo7p-8b7m1p-EdLZZPKYpXYvg=",
    };

    const updateParams = {
      TableName: COMPANY_TABLE,
      Key: {
        companyId: companyId,
      },
      UpdateExpression: "SET companyName = :companyName, latitude = :latitude, email = :email, contactNo = :contactNo, longitude = :longitude, radiusFromCenterOfCompany = :radiusFromCenterOfCompany, companyImageUrl = :companyImageUrl",
      ExpressionAttributeValues: {
        ":companyName": updatedCompany.companyName,
        ":latitude": updatedCompany.latitude,
        ":email": updatedCompany.email,
        ":contactNo": updatedCompany.contactNo,
        ":longitude": updatedCompany.longitude,
        ":radiusFromCenterOfCompany": updatedCompany.radiusFromCenterOfCompany,
        ":companyImageUrl": updatedCompany.companyImageUrl,
      },
      ReturnValues: "ALL_NEW",
    };

    const { Attributes: updatedAttributes } = await dynamoDbClient.send(new UpdateCommand(updateParams));

    res.json(updatedAttributes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error updating company" });
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
