## Users Endpoints (`users.js`)

### 1. Login
- **Endpoint:** `POST /api/users/login`
- **Request:**
  ```json
  {
    "email": "user@example.com",
    "password": "password123",
    "role": "employee"
  }
  ```
- **Response:**
  ```json
  {
    "token": "your_jwt_token_here",
    "role": "employee"
  }
  ```

### 2. Get User Information
- **Endpoint:** `GET /api/users/:userId`
- **Request Header:**
  - `Authorization: Bearer your_jwt_token_here`
- **Response:**
  ```json
  {
    "userId": "unique_user_id",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "employee"
  }
  ```

### 3. Edit User Information (Admin Only)
- **Endpoint:** `PUT /api/users/edit/:userId`
- **Request Header:**
  - `Authorization: Bearer your_jwt_token_here`
- **Request:**
  ```json
  {
    "name": "Updated Name",
    "email": "updated@example.com",
    "role": "employee",
    "username": "updated_username",
    "contactNo": "1234567890",
    "birthday": "1990-01-01",
    "joinday": "2020-01-01",
    "permissions": ["permission1", "permission2"]
  }
  ```
- **Response:**
  ```json
  {
    "userId": "unique_user_id",
    "name": "Updated Name",
    "email": "updated@example.com",
    "role": "employee",
    "username": "updated_username",
    "contactNo": "1234567890",
    "birthday": "1990-01-01",
    "joinday": "2020-01-01",
    "permissions": ["permission1", "permission2"]
  }
  ```

### 4. Get All Employees (Admin Only)
- **Endpoint:** `GET /api/users/employees/all`
- **Request Header:**
  - `Authorization: Bearer your_jwt_token_here`
- **Response:**
  ```json
  [
    {
      "userId": "unique_user_id_1",
      "name": "Employee 1",
      "email": "employee1@example.com",
      "role": "employee"
    },
    {
      "userId": "unique_user_id_2",
      "name": "Employee 2",
      "email": "employee2@example.com",
      "role": "employee"
    },
    // ... more employees
  ]
  ```

### 5. Get All Supervisors (Admin Only)
- **Endpoint:** `GET /api/users/supervisors/all`
- **Request Header:**
  - `Authorization: Bearer your_jwt_token_here`
- **Response:**
  ```json
  [
    {
      "userId": "unique_user_id_1",
      "name": "Supervisor 1",
      "email": "supervisor1@example.com",
      "role": "supervisor"
    },
    {
      "userId": "unique_user_id_2",
      "name": "Supervisor 2",
      "email": "supervisor2@example.com",
      "role": "supervisor"
    },
    // ... more supervisors
  ]
  ```

### 6. Get All HR Persons (Admin Only)
- **Endpoint:** `GET /api/users/hr/all`
- **Request Header:**
  - `Authorization: Bearer your_jwt_token_here`
- **Response:**
  ```json
  [
    {
      "userId": "unique_user_id_1",
      "name": "HR Person 1",
      "email": "hr1@example.com",
      "role": "hr"
    },
    {
      "userId": "unique_user_id_2",
      "name": "HR Person 2",
      "email": "hr2@example.com",
      "role": "hr"
    },
    // ... more HR persons
  ]
  ```

### 7. Create User (Admin Only)
- **Endpoint:** `POST /api/users/create-user`
- **Request Header:**
  - `Authorization: Bearer your_jwt_token_here`
- **Request:**
  ```json
  {
    "name": "New User",
    "email": "newuser@example.com",
    "password": "password123",
    "role": "employee",
    "username": "new_username",
    "contactNo": "1234567890",
    "birthday": "1995-01-01",
    "joinday": "2022-01-01",
    "permissions": ["permission1", "permission2"]
  }
  ```
- **Response:**
  ```json
  {
    "userId": "unique_user_id",
    "name": "New User",
    "email": "newuser@example.com",
    "role": "employee",
    "username": "new_username",
    "contactNo": "1234567890",
    "birthday": "1995-01-01",
    "joinday": "2022-01-01",
    "permissions": ["permission1", "permission2"]
  }
  ```

### 8. Create Company (Superadmin Only)
- **Endpoint:** `POST /api/users/company/create`
- **Request Header:**
  - `Authorization: Bearer your_jwt_token_here`
- **Request:**
  ```json
  {
    "companyName": "New Company",
    "companyLocation": "City, Country",
    "companyEmail": "info@newcompany.com"
  }
  ```
- **Response:**
  ```json
  {
    "companyId": "unique_company_id",
    "companyName": "New Company",
    "companyLocation": "City, Country",
    "companyEmail": "info@newcompany.com"
  }
  ```

### 9. Create Admin User (Superadmin Only)
- **Endpoint:** `POST /api/users/create-admin`
- **Request Header:**
  - `Authorization: Bearer your_jwt_token_here`
- **Request:**
  ```json
  {
    "name": "Admin User",
    "email": "admin@example.com",
    "contactNo": "1234567890",
    "username": "admin_username",
    "password": "adminpassword123",
    "companyId": "unique_company_id"
  }
  ```
- **Response:**
  ```json
  {
    "userId": "unique_user_id",
    "name": "Admin User",
    "email": "admin@example.com",
    "contactNo": "1234567890",
    "username": "admin_username",
    "companyId": "unique_company_id",
    "companyName": "New Company",
    "role": "admin"
  }
  ```

## Calendar Endpoints (`calendar.js`)

### 1. Get Leave for a Specific Day and Employee
- **Endpoint:** `GET /api/calendar/leaves/:day/:employeeId`
- **Request

 Header:**
  - `Authorization: Bearer your_jwt_token_here`
- **Response:**
  ```json
  {
    "Day": "2022-01-01",
    "EmployeeId": "unique_employee_id",
    "LeaveType": "Sick Leave"
  }
  ```

### 2. Get Holiday for a Specific Day
- **Endpoint:** `GET /api/calendar/holidays/:day`
- **Request Header:**
  - `Authorization: Bearer your_jwt_token_here`
- **Response:**
  ```json
  {
    "Day": "2022-01-01",
    "Desc": "New Year's Day"
  }
  ```

### 3. Add Holiday (Admin or HR Only)
- **Endpoint:** `POST /api/calendar/holidays`
- **Request Header:**
  - `Authorization: Bearer your_jwt_token_here`
- **Request:**
  ```json
  {
    "day": "2022-12-25",
    "desc": "Christmas Day"
  }
  ```
- **Response:**
  ```json
  {
    "day": "2022-12-25",
    "desc": "Christmas Day"
  }
  ```

### 4. Get All Holidays
- **Endpoint:** `GET /api/calendar/holidays`
- **Request Header:**
  - `Authorization: Bearer your_jwt_token_here`
- **Response:**
  ```json
  [
    {
      "Day": "2022-01-01",
      "Desc": "New Year's Day"
    },
    {
      "Day": "2022-12-25",
      "Desc": "Christmas Day"
    },
    // ... more holidays
  ]
  ```

### 5. Get All Leaves (Admin or HR Only)
- **Endpoint:** `GET /api/calendar/leaves/all`
- **Request Header:**
  - `Authorization: Bearer your_jwt_token_here`
- **Response:**
  ```json
  [
    {
      "LeaveType": "Sick Leave",
      "EmployeeId": "unique_employee_id",
      "Day": "2022-01-01"
    },
    {
      "LeaveType": "Vacation",
      "EmployeeId": "unique_employee_id",
      "Day": "2022-02-15"
    },
    // ... more leaves
  ]
  ```

### 6. Add Leave
- **Endpoint:** `POST /api/calendar/leaves`
- **Request Header:**
  - `Authorization: Bearer your_jwt_token_here`
- **Request:**
  ```json
  {
    "day": "2022-02-15",
    "empId": "unique_employee_id",
    "leaveType": "Vacation"
  }
  ```
- **Response:**
  ```json
  {
    "day": "2022-02-15",
    "empId": "unique_employee_id",
    "leaveType": "Vacation"
  }
  ```