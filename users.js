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
const errors = require('./config/errors');
const { isWithinRadius } = require("./utils/geoFencing");
const { uploadImage } = require("./utils/imageUpload");
const urls = require("./config/urls");
const messages = require('./config/messages');

const app = express();

const ADMINS_TABLE = process.env.ADMINS_TABLE;
const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE;
const COMPANY_TABLE = process.env.COMPANY_TABLE;
const ATTENDANCE_TABLE = process.env.ATTENDANCE_TABLE;
const JWT_SECRET = process.env.JWT_SECRET; 
const companyDefaultImage = urls.companyDefaultImage;

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
      res.status(400).json({ error: errors.invalidInputData });
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
      res.status(404).json({ error: errors.adminCompanyInfoNotFound });
      return;
    }

    // Extract company details
    const { latitude: companyLat, longitude: companyLon, radiusFromCenterOfCompany } = company;

    // Check if the user is within the predefined radius
    const withinRadius = isWithinRadius(parseFloat(userLat), parseFloat(userLon), companyLat, companyLon, radiusFromCenterOfCompany);

    res.json({ withinRadius });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: errors.userWithinRadiusError });
  }
});
app.post("/api/users/attendance/mark", rolesMiddleware(["hr","employee"]), async function (req, res) {
  try {
    const { employeeId, companyId, time, isCheckedIn, isCheckedOut, isWorkFromHome } = req.body;

    // Validate input data
    if (!employeeId || !companyId || !time || isCheckedIn === undefined || isCheckedOut === undefined || isWorkFromHome === undefined) {
      return res.status(400).json({ error: errors.invalidInputData});
    }

    // Check if the employee exists
    const employeeParams = {
      TableName: EMPLOYEES_TABLE,
      Key: { userId: employeeId },
    };

    const { Item: employee } = await dynamoDbClient.send(new GetCommand(employeeParams));

    if (!employee || employee.companyId !== companyId) {
      return res.status(404).json({ error: errors.userNotFound });
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
        return res.status(400).json({ error: errors.alreadyCheckedIn });
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
        return res.json({ message: messages.checkInMarkedSuccess});
      }
    }

    // If a check-out is marked
    if (isCheckedOut) {
      if (!existingAttendance || !existingAttendance.isCheckedIn) {
        return res.status(400).json({ error: errors.previousCheckInNotFound });
      }
      if (existingAttendance.isCheckedOut) {
        return res.status(400).json({ error: errors.alreadyCheckedOut });
      }
      // Update the existing record for check-out
      existingAttendance.isCheckedOut = true;
      existingAttendance.time = time;
      await dynamoDbClient.send(new PutCommand({ TableName: ATTENDANCE_TABLE, Item: existingAttendance }));
      return res.json({ message: messages.checkOutMarkedSuccess });
    }

    return res.status(400).json({ error: errors.invalidInputData });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: errors.markAttendanceError });
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
      return res.status(404).json({ error: errors.attendanceRecordNotFound });
    }

    return res.json(existingAttendance);
  } catch (error) {
    return res.status(500).json({ error: errors.retrieveAttendanceError });
  }
});

app.get("/api/users/:userId", rolesMiddleware(["admin","branchadmin","hr","employee"]), async function (req, res) { 
  const params = {
    TableName: EMPLOYEES_TABLE,
    Key: {
      userId: req.params.userId,
    },
  };

  try {
    const { Item } = await dynamoDbClient.send(new GetCommand(params));
    if (Item) {
      res.json(Item);
    } else {
      res.status(404).json({ error: errors.userNotFound });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: errors.getUsersError });
}});

app.get("/api/users/branch-admin/:id", rolesMiddleware(["admin"]), async function (req, res) {
  try {
    const branchAdminId = req.params.id;
    const params = {
      TableName: ADMINS_TABLE,
      Key: {
        userId: branchAdminId,
      },
    };

    const { Item: branchAdmin } = await dynamoDbClient.send(new GetCommand(params));

    if (branchAdmin) {
      res.json(branchAdmin);
    } else {
      res.status(404).json({ error: errors.branchAdminNotFound });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: errors.getBranchAdminError });
  }
});

app.patch("/api/users/edit/:userId", rolesMiddleware(["admin","branchadmin"]), async function (req, res) {
  const userId = req.params.userId;
  const { contactNo,branchId, dateOfBirth, designation: role, email,branchName, joiningDate, firstName, lastName, username } = req.body;
  
  // Validate input data
  if (
    (typeof contactNo !== "string" && typeof contactNo !== "number") ||
    typeof dateOfBirth !== "string" ||
    typeof role !== "string" ||
    typeof email !== "string" ||
    typeof joiningDate !== "string" ||
    typeof firstName !== "string" ||
    typeof lastName !== "string" ||
    typeof username !== "string" ||
    typeof branchId !== "string"||
    typeof branchName !== "string"
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
      res.status(500).json({ error: errors.imageUploadError });
      return;
    }
  }

  const params = {
    TableName: EMPLOYEES_TABLE,
    Key: {
      userId: userId,
    },
  };

  const { Item: existingUser } = await dynamoDbClient.send(new GetCommand(params));

  if (!existingUser) {
    res.status(404).json({ error: errors.userNotFound });
    return;
  }

  const updatedUser = {
    ...existingUser,
    contactNo: contactNo || existingUser.contactNo,
    dateOfBirth: dateOfBirth || existingUser.dateOfBirth,
    role: role || existingUser.role,
    email: email || existingUser.email,
    joiningDate: joiningDate || existingUser.joiningDate,
    firstName: firstName || existingUser.firstName,
    lastName: lastName || existingUser.lastName,
    username: username || existingUser.username,
    imageUrl: imageUrl || existingUser.imageUrl,
    branchName: branchName || existingUser.branchName,
    branchId: branchId || existingUser.branchId,
  };

  const updateParams = {
    TableName: EMPLOYEES_TABLE,
    Key: {
      userId: userId,
    },
    UpdateExpression: "SET contactNo = :contactNo,branchId = :branchId, dateOfBirth = :dateOfBirth, #r = :role, email = :email, joiningDate = :joiningDate, firstName = :firstName, lastName = :lastName, username = :username, imageUrl = :imageUrl, branchName = :branchName", // Replace role with #r and add ExpressionAttributeNames
    ExpressionAttributeValues: {
      ":contactNo": updatedUser.contactNo,
      ":dateOfBirth": updatedUser.dateOfBirth,
      ":role": updatedUser.role,
      ":email": updatedUser.email,
      ":joiningDate": updatedUser.joiningDate,
      ":firstName": updatedUser.firstName,
      ":lastName": updatedUser.lastName,
      ":username": updatedUser.username,
      ":imageUrl": updatedUser.imageUrl,
      ":branchName": updatedUser.branchName,
      ":branchId": updatedUser.branchId
    },
    ExpressionAttributeNames: {
      "#r": "role", // Specify that #r should be replaced with "role"
    },
    ReturnValues: "ALL_NEW",
  };
  
  

  try {
    const { Attributes: updatedAttributes } = await dynamoDbClient.send(new UpdateCommand(updateParams));
    res.json(updatedAttributes);
  }
  catch (error) {
    console.error(error);
    res.status(500).json({ error: errors.updateUserError });
  }

});

app.patch("/api/users/branch-admin/:id", rolesMiddleware(["admin"]), async function (req, res) {
const {branchId, contactNo, email, firstName, lastName, username,branchName } = req.body;

// Validate input data
if (
  typeof branchId !== "string" ||
  typeof contactNo !== "string" ||
  typeof email !== "string" ||
  typeof firstName !== "string" ||
  typeof lastName !== "string" ||
  typeof username !== "string"||
  typeof branchName !== "string"
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
    res.status(500).json({ error: errors.imageUploadError });
    return;
  }
}

const branchAdminId = req.params.id;

const params = {
  TableName: ADMINS_TABLE,
  Key: {
    userId: branchAdminId,
  },
};

const { Item: existingBranchAdmin } = await dynamoDbClient.send(new GetCommand(params));

if (!existingBranchAdmin) {
  res.status(404).json({ error: errors.branchAdminNotFound });
  return;

}

const updatedBranchAdmin = {
  ...existingBranchAdmin,
  branchId: branchId || existingBranchAdmin.branchId,
  contactNo: contactNo || existingBranchAdmin.contactNo,
  email: email || existingBranchAdmin.email,
  firstName: firstName || existingBranchAdmin.firstName,
  lastName: lastName || existingBranchAdmin.lastName,
  username: username || existingBranchAdmin.username,
  imageUrl: imageUrl || existingBranchAdmin.adminImageUrl,
  branchName: branchName || existingBranchAdmin.branchName,
};

const updateParams = {
  TableName: ADMINS_TABLE,
  Key: {
    userId: branchAdminId,
  },
  UpdateExpression: "SET branchId = :branchId, contactNo = :contactNo, email = :email, firstName = :firstName, lastName = :lastName, username = :username, imageUrl = :imageUrl, branchName = :branchName",
  ExpressionAttributeValues: {
    ":branchId": updatedBranchAdmin.branchId,
    ":contactNo": updatedBranchAdmin.contactNo,
    ":email": updatedBranchAdmin.email,
    ":firstName": updatedBranchAdmin.firstName,
    ":lastName": updatedBranchAdmin.lastName,
    ":username": updatedBranchAdmin.username,
    ":imageUrl": updatedBranchAdmin.adminImageUrl,
    ":branchName": updatedBranchAdmin.branchName,
  },
  ReturnValues: "ALL_NEW",
};

try {
  const { Attributes: updatedAttributes } = await dynamoDbClient.send(new UpdateCommand(updateParams));
  res.json(updatedAttributes);
}
catch (error) {
  console.error(error);
  res.status(500).json({ error: errors.updateBranchAdminError });
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

app.get("/api/users/branch/employees/all/:role/:branchId", rolesMiddleware(["branchadmin"]), async function (req, res) {
  try {
    const branchAdminUserId = req.user.userId;
    const branchId = req.params.branchId;
    const role = req.params.role;

    // Retrieve the branch admin's company information from the database
    const branchAdminParams = {
      TableName: ADMINS_TABLE,
      Key: {
        userId: branchAdminUserId,
      },
    };

    const { Item: branchAdmin } = await dynamoDbClient.send(new GetCommand(branchAdminParams));

    if (!branchAdmin || !branchAdmin.companyId) {
      res.status(400).json({ error: errors.userNotFound });
      return;
    }

    // Search for the user with the provided userId
    const employeeParams = {
      TableName: EMPLOYEES_TABLE,
      FilterExpression: "#branchId = :branchId AND #role = :role",
      ExpressionAttributeNames: {
        "#branchId": "branchId",
        "#role": "role",
      },
      ExpressionAttributeValues: {
        ":branchId": branchId,
        ":role": role,
      },
    };

    const { Items: employeePersons } = await dynamoDbClient.send(new ScanCommand(employeeParams));
console.log(employeePersons);
    res.json(employeePersons);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: errors.getEmployeePersonsError });
  }
});

app.get("/api/users/supervisors/all", rolesMiddleware(["admin"]), async function (req, res) {
  try {
    console.log(req.user.userId);
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

app.get("/api/users/getCompanyId/:id", rolesMiddleware(["superadmin","admin","branchadmin","hr","employee"]), async function (req, res) {
  try {
    const userId = req.params.id;
    const userParams = {
      TableName: EMPLOYEES_TABLE,
      Key: {
        userId: userId,
      },
    };

    const adminsParams = {
      TableName: ADMINS_TABLE,
      Key: {
        userId: userId,
      },
    };

    const { Item: admin } = await dynamoDbClient.send(new GetCommand(adminsParams));
    const { Item: user } = await dynamoDbClient.send(new GetCommand(userParams));
  
    if (admin) {
      res.json(admin.companyId);
    } else if (user) {
      res.json(user.companyId);
    } else {
      res.status(404).json({ error: errors.userNotFound });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: errors.getCompanyIdError });
  }

} );

app.get("/api/users/company/branch-id/", rolesMiddleware(["admin","branchadmin","hr","employee"]), async function (req, res) {

  try {
    const userId = req.user.userId;
    const userParams = {
      TableName: EMPLOYEES_TABLE,
      Key: {
        userId: userId,
      },
    };

    const adminsParams = {
      TableName: ADMINS_TABLE,
      Key: {
        userId: userId,
      },
    };

    const { Item: admin } = await dynamoDbClient.send(new GetCommand(adminsParams));
    const { Item: user } = await dynamoDbClient.send(new GetCommand(userParams));

    if (admin) {
      res.json(
        {
          branchId: admin.branchId,
          branchName: admin.branchName
        }
      );
    } else if (user) {
      res.json(
        {
          branchId: user.branchId,
          branchName: user.branchName
        }
      );
    } else {
      res.status(404).json({ error: errors.userNotFound });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: errors.getBranchIdError });
  }
});

app.get("/api/users/company/:id", rolesMiddleware(["superadmin","admin","branchadmin"]), async function (req, res) {
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

app.post("/api/users/create-user", rolesMiddleware(["admin","branchadmin"]), async function (req, res) {
   const { companyId,contactNo, dateOfBirth, designation,branchName, email, joiningDate,firstName, lastName,username,branchId } = req.body;
   
  // Validate input data
  if (
    typeof companyId !== "string" ||
    typeof contactNo !== "string" ||
    typeof dateOfBirth !== "string" ||
    typeof designation !== "string" ||
    typeof email !== "string" ||
    typeof joiningDate !== "string" ||
    typeof firstName !== "string" ||
    typeof lastName !== "string" ||
    typeof username !== "string"||
    typeof branchId !== "string"||
    typeof branchName !== "string"
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
      res.status(500).json({ error: errors.imageUploadError });
      return;
    }
  }

  const userId = uuidv4();

  const password = bcrypt.hashSync("employee123", 10);

  const params = {
    TableName: EMPLOYEES_TABLE,
    Item: {
      userId: userId,
      companyId: companyId,
      contactNo: contactNo,
      dateOfBirth: dateOfBirth,
      role: designation,
      email: email,
      joiningDate: joiningDate,
      firstName: firstName,
      lastName: lastName,
      username: username,
      password: password,
      branchId: branchId,
      imageUrl: imageUrl || urls.employeeDefaultImage,
      branchName: branchName,
    },
  };

  try {
    await dynamoDbClient.send(new PutCommand(params));
    res.json({
      userId,
      companyId,
      contactNo,
      dateOfBirth,
      role: designation,
      email,
      joiningDate,
      firstName,
      lastName,
      username,
      branchId,
      imageUrl,
      branchName,
    });
  }
  catch (error) {
    console.error(error);
    res.status(500).json({ error: errors.createUserError });
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
      companyImageUrl: imageUrl || companyDefaultImage,
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

app.post("/api/users/company/create-branch", rolesMiddleware(["admin"]), async function (req, res) {
  const { branchName, companyId, contactNo, email, latitude, longitude, radiusFromCenterOfBranch } = req.body;
console.log(req.body);
  if (
    typeof branchName !== "string" ||
    typeof companyId !== "string" ||
    typeof contactNo !== "string" ||
    typeof email !== "string" ||
    typeof latitude !== "string" ||
    typeof longitude !== "string" ||
    typeof radiusFromCenterOfBranch !== "string"
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
      res.status(500).json({ error: errors.imageUploadError });
      return;
    }
  }

  const branchId = uuidv4(); // Generate a unique branchId

  const params = {
    TableName: COMPANY_TABLE,
    Key: {
      companyId: companyId,
    },
  };

  const { Item: company } = await dynamoDbClient.send(new GetCommand(params));

  if (!company) {
    res.status(404).json({ error: errors.companyNotFound });
    return;
  }

  const branches = company.branches || [];
  branches.push({
    branchId,
    branchName,
    location: {
      longitude,
      latitude,
    },
    branchEmail: email,
    contactNo,
    branchImageUrl: imageUrl || urls.companyDefaultImage,
    radiusFromCenterOfBranch,
  });

  console.log(branches);

  const updateParams = {
    TableName: COMPANY_TABLE,
    Key: {
      companyId: companyId,
    },
    UpdateExpression: "SET branches = :branches",
    ExpressionAttributeValues: {
      ":branches": branches,
    },
    ReturnValues: "ALL_NEW",
  };

  try {
    const { Attributes: updatedAttributes } = await dynamoDbClient.send(new UpdateCommand(updateParams));
    res.json(updatedAttributes);
  }
  catch (error) {
    console.error(error);
    res.status(500).json({ error: errors.createBranchError });
  }

});

app.get("/api/users/branch/:id", rolesMiddleware(["admin",]), async function (req, res) {
  try {
    const branchId = req.params.id;
    const params = {
      TableName: COMPANY_TABLE,
      Key: {
        companyId: req.user.companyId,
      },
    };

    const { Item: company } = await dynamoDbClient.send(new GetCommand(params));

    if (!company) {
      res.status(404).json({ error: errors.companyNotFound });
      return;
    }

    const branch = company.branches.find((branch) => branch.branchId === branchId);
    if (!branch) {
      res.status(404).json({ error: errors.branchNotFound });
      return;
    }

    res.json(branch);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: errors.getBranchError });
  }
});

app.post("/api/users/create-branch-admin", rolesMiddleware(["admin"]), async function (req, res) {
  const { branchId, companyId, contactNo, email, firstName, lastName, username } = req.body;

  // Validate input data
  if (
    typeof branchId !== "string" ||
    typeof companyId !== "string" ||
    typeof contactNo !== "string" ||
    typeof email !== "string" ||
    typeof firstName !== "string" ||
    typeof lastName !== "string" ||
    typeof username !== "string"
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
      res.status(500).json({ error: errors.imageUploadError });
      return;
    }
  }

  const userId = uuidv4();

  const password = bcrypt.hashSync("admin123", 10);

  // Check if the branchId exists in the branches array of the company

  const params = {
    TableName: COMPANY_TABLE,
    Key: {
      companyId: companyId,
    },
  };

  const { Item: company } = await dynamoDbClient.send(new GetCommand(params));

  if (!company) {
    res.status(404).json({ error: errors.companyNotFound });
    return;
  }

  const branch = company.branches.find((branch) => branch.branchId === branchId);

  if (!branch) {
    res.status(404).json({ error: errors.branchNotFound });
    return;
  }

  // Branch found, include branchId and branchName in the admin data
  const paramsAdmins = {
    TableName: ADMINS_TABLE,
    Item: {
      userId: userId,
      firstName: firstName,
      lastName: lastName,
      email: email,
      contactNo: contactNo,
      role: "branchadmin",
      branchId: branchId,
      branchName: branch.branchName,
      companyId: companyId,
      password: password,
      companyName: company.companyName,
      adminImageUrl: imageUrl || urls.adminDefaultImage,
    },
  };

  try {
    await dynamoDbClient.send(new PutCommand(paramsAdmins));
    res.json({
      userId,
      firstName,
      lastName,
      email,
      contactNo,
      role: "branchadmin",
      branchId,
      branchName: branch.branchName,
      companyId,
      companyName: company.companyName,
      adminImageUrl: imageUrl,
    });
  }
  catch (error) {
    console.error(error);
    res.status(500).json({ error: errors.createBranchAdminError });
  }

});

app.get("/api/users/company/branch-admins/:companyId", rolesMiddleware(["admin"]), async function (req, res) {

  try {
    const companyId = req.params.companyId;

    const params = {
      TableName: ADMINS_TABLE,
      FilterExpression: "#companyId = :companyId AND #role = :role",
      ExpressionAttributeNames: {
        "#companyId": "companyId",
        "#role": "role",
      },
      ExpressionAttributeValues: {
        ":companyId": companyId,
        ":role": "branchadmin",
      },
    };

    const { Items: branchAdmins } = await dynamoDbClient.send(new ScanCommand(params));
    
    res.json(branchAdmins);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: errors.getBranchAdminsError });
  }

});

app.get("/api/users/company/branches/:companyId", rolesMiddleware(["admin"]), async function (req, res) {
  try {
    console.log(req.params.companyId);
    const companyId = req.params.companyId;
    console.log(companyId,"hiii");
    const params = { 
      TableName: COMPANY_TABLE,
      Key: {
        companyId: companyId,
      }, 
    };
  
    const { Item: company } = await dynamoDbClient.send(new GetCommand(params));

    if (!company) {
      res.status(404).json({ error: errors.companyNotFound });
      return;
    }

    res.json(company.branches);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: errors.getBranchesError });
  }

});

app.patch("/api/users/company/branch/:branchId", rolesMiddleware(["admin"]), async function (req, res) {
  try {
    const branchId = req.params.branchId;
    const { branchName, contactNo, email, latitude, longitude, radiusFromCenterOfBranch } = req.body;

    // Validate input data
    if (
      typeof branchName !== "string" ||
      typeof contactNo !== "string" ||
      typeof email !== "string" ||
      typeof latitude !== "string" ||
      typeof longitude !== "string" ||
      typeof radiusFromCenterOfBranch !== "string"
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
        res.status(500).json({ error: errors.imageUploadError });
        return;
      }
    }

    const params = {
      TableName: COMPANY_TABLE,
      Key: {
        companyId: req.user.companyId,
      },
    };

    const { Item: company } = await dynamoDbClient.send(new GetCommand(params));

    if (!company) {
      res.status(404).json({ error: errors.companyNotFound });
      return;
    }

    const branch = company.branches.find((branch) => branch.branchId === branchId);

    if (!branch) {
      res.status(404).json({ error: errors.branchNotFound });
      return;
    }

    const updatedBranch = {
      ...branch,
      branchName: branchName || branch.branchName,
      location: {
        latitude: latitude || branch.location.latitude,
        longitude: longitude || branch.location.longitude,
      },
      branchEmail: email || branch.branchEmail,
      contactNo: contactNo || branch.contactNo,
      branchImageUrl: imageUrl || branch.branchImageUrl || urls.companyDefaultImage,
      radiusFromCenterOfBranch: radiusFromCenterOfBranch || branch.radiusFromCenterOfBranch,
    };

    const updateParams = {
      TableName: COMPANY_TABLE,
      Key: {
        companyId: req.user.companyId,
      },
      UpdateExpression: "SET branches = :branches",
      ExpressionAttributeValues: {
        ":branches": company.branches.map((branch) => (branch.branchId === branchId ? updatedBranch : branch)),
      },
      ReturnValues: "ALL_NEW",
    };

    const { Attributes: updatedAttributes } = await dynamoDbClient.send(new UpdateCommand(updateParams));

    res.json(updatedAttributes);

  } catch (error) {

    console.error(error);
    res.status(500).json({ error: errors.updateBranchError });
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
      
      imageUrl = uploadResult.imageUrl;
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: errors.imageUploadError });
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
      role: "companyadmin",
      companyId: companyId,
      companyName: companyName,
      password: password,
      adminImageUrl: imageUrl || urls.adminDefaultImage,
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
      role: "companyadmin",
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
        res.status(500).json({ error: errors.imageUploadError });
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
      res.status(404).json({ error: errors.adminInfoNotFound });
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
      adminImageUrl: imageUrl || existingAdmin.adminImageUrl || urls.adminDefaultImage,
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
    res.status(500).json({ error: errors.updateUserError });
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
        res.status(500).json({ error: errors.imageUploadError });
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
      res.status(404).json({ error: errors.companyNotFound });
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
      companyImageUrl: imageUrl || existingCompany.companyImageUrl || companyDefaultImage,
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
    res.status(500).json({ error: errors.updateCompanyError });
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


    // Set the expiration time for the token (e.g., 1 hour from now) in milliseconds
    const expiresInMilliseconds = 3600 * 1000 * 24; // 1 day in milliseconds
    const expirationTime = Date.now() + expiresInMilliseconds;

    const token = jwt.sign({
      userId: user.userId,
      companyId: user.companyId,
      role: user.role,
      exp: expirationTime, // Set the expiration time in the payload
    }, JWT_SECRET);

    res.json({
      token,
      role: user.role,
      userId: user.userId,
      companyId: user.companyId,
      expiresIn: expiresInMilliseconds, // Include the expiration time in the response
    });

  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: errors.getUsersError });
  }
});



module.exports.handler = serverless(app);
