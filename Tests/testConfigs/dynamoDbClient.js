const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

// Configure the AWS DynamoDB client
const dynamoDbClient = new DynamoDBClient({
  region: "us-west-2", // Specify your desired AWS region
  // Add any other configuration options you need, such as credentials
});

module.exports = { dynamoDbClient };
