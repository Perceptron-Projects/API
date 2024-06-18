const { isWithinRadius } = require('../utils/geoFencing'); // Update yourFileName with the correct path to your file

describe('isWithinRadius', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return true if the distance is within the specified radius', () => {
    // Coordinates for user and predefined location
    const userLat = 37.7749;
    const userLon = -122.4194;
    const predefinedLat = 37.7749;
    const predefinedLon = -122.4194;
    
    // Radius in kilometers
    const radius = 1;

    // Mock the haversineDistance function to return a value less than the radius
    const haversineDistanceMock = jest.spyOn(global.Math, 'sin').mockReturnValueOnce(0.5);
    const result = isWithinRadius(userLat, userLon, predefinedLat, predefinedLon, radius);

    // Expect the result to be true
    expect(result).toBe(true);

    // Verify the mock call
    expect(haversineDistanceMock).toHaveBeenCalledTimes(4); // Expecting three sin calls for dLat and dLon calculations
  });

  it('should return false if the distance is greater than the specified radius', () => {
    // Coordinates for user and predefined location
    const userLat = 37.7749;
    const userLon = -122.4194;
    const predefinedLat = 31.7749;
    const predefinedLon = -123.4194;
    
    // Radius in kilometers
    const radius = 1;

    // Mock the haversineDistance function to return a value greater than the radius
    const haversineDistanceMock = jest.spyOn(global.Math, 'sin').mockReturnValueOnce(0.6);
    const result = isWithinRadius(userLat, userLon, predefinedLat, predefinedLon, radius);

    // Expect the result to be false
    expect(result).toBe(false);

    // Verify the mock call
    expect(haversineDistanceMock).toHaveBeenCalledTimes(4); // Expecting three sin calls for dLat and dLon calculations
  });
});


