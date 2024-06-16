function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
  
    // Convert latitude and longitude from degrees to radians
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
  
    // Haversine formula
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
    // Distance in meters
    const distance = R * c * 1000;
  
    return distance;
  }
  
  function isWithinRadius(userLat, userLon, predefinedLat, predefinedLon, radius) {
    const distance = haversineDistance(userLat, userLon, predefinedLat, predefinedLon);
  
    return distance <= radius;
  }

    module.exports = {isWithinRadius };