/**
 * Calculate delivery fare based on multiple factors
 */
export const calculateFare = ({
  distance, // in km
  itemWeight, // in kg
  itemType,
  vehicleType = "bike",
  isFragile = false,
  itemValue = 0,
  surgeMultiplier = 1
}) => {
  // Base fares by vehicle type (in Naira)
  const baseFares = {
    bike: 200,
    car: 400,
    van: 600,
    truck: 1000
  };

  // Distance rate per km (in Naira)
  const distanceRates = {
    bike: 50,
    car: 80,
    van: 120,
    truck: 200
  };

  // Weight rate per kg (in Naira)
  const weightRates = {
    bike: 20,
    car: 30,
    van: 40,
    truck: 50
  };

  // Special item surcharges
  const itemSurcharges = {
    fragile: 100,
    perishable: 80,
    electronic: 150,
    furniture: 200,
    document: 0
  };

  // Insurance fee based on item value (0.5% of value)
  const insuranceFee = itemValue > 10000 ? itemValue * 0.005 : 0;

  // Get rates for vehicle type
  const baseFare = baseFares[vehicleType] || baseFares.bike;
  const distanceFare = distance * (distanceRates[vehicleType] || distanceRates.bike);
  const weightFare = itemWeight * (weightRates[vehicleType] || weightRates.bike);
  
  // Item type surcharge
  const itemSurcharge = itemSurcharges[itemType] || 0;
  const fragileSurcharge = isFragile ? itemSurcharges.fragile : 0;

  // Calculate total
  let totalFare = baseFare + distanceFare + weightFare + itemSurcharge + fragileSurcharge + insuranceFee;
  
  // Apply surge pricing
  totalFare *= surgeMultiplier;

  // Minimum fare
  const minFare = vehicleType === "bike" ? 300 : 500;
  totalFare = Math.max(totalFare, minFare);

  // Round to nearest 10
  totalFare = Math.ceil(totalFare / 10) * 10;

  return {
    baseFare,
    distanceFare,
    weightFare,
    itemSurcharge,
    fragileSurcharge,
    insuranceFee,
    surgeMultiplier,
    totalFare,
    currency: "NGN"
  };
};

/**
 * Calculate surge multiplier based on demand
 */
export const calculateSurgeMultiplier = (demandLevel, timeOfDay) => {
  let multiplier = 1.0;

  // Time-based surge
  const hour = new Date().getHours();
  if (hour >= 17 && hour <= 20) {
    multiplier *= 1.2; // Evening rush hour
  } else if (hour >= 7 && hour <= 9) {
    multiplier *= 1.1; // Morning rush hour
  }

  // Demand-based surge
  switch (demandLevel) {
    case "high":
      multiplier *= 1.5;
      break;
    case "very_high":
      multiplier *= 2.0;
      break;
    case "extreme":
      multiplier *= 3.0;
      break;
  }

  // Cap surge multiplier
  return Math.min(multiplier, 3.0);
};