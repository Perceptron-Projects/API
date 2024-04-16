const request = require('supertest');
const app = require('./users');

describe('GET /api/users/isWithinRadius/:companyId', () => {
  it('should return 200 and withinRadius true when user is within the radius', async () => {
    const response = await request(app)
      .get('/api/users/isWithinRadius/COMPANY_ID')
      .query({ userLat: 'USER_LAT', userLon: 'USER_LON' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('withinRadius', true);
  });

  it('should return 400 when companyId, userLat, or userLon is missing', async () => {
    const response = await request(app)
      .get('/api/users/isWithinRadius/COMPANY_ID');

    expect(response.status).toBe(400);
  });

  it('should return 404 when company is not found', async () => {
    // Mock DynamoDBClient to return null for company
    const mockDynamoDbClient = {
      send: jest.fn().mockResolvedValue({ Item: null }),
    };
    const appWithMockClient = require('./app');
    appWithMockClient.set('dynamoDbClient', mockDynamoDbClient);

    const response = await request(appWithMockClient)
      .get('/api/users/isWithinRadius/COMPANY_ID')
      .query({ userLat: 'USER_LAT', userLon: 'USER_LON' });

    expect(response.status).toBe(404);
  });

  it('should return 500 when there is an internal server error', async () => {
    // Mock DynamoDBClient to throw an error
    const mockDynamoDbClient = {
      send: jest.fn().mockRejectedValue(new Error('Internal server error')),
    };
    const appWithMockClient = require('./app');
    appWithMockClient.set('dynamoDbClient', mockDynamoDbClient);

    const response = await request(appWithMockClient)
      .get('/api/users/isWithinRadius/COMPANY_ID')
      .query({ userLat: 'USER_LAT', userLon: 'USER_LON' });

    expect(response.status).toBe(500);
  });
});
