// utils/geocoding.js
import axios from "axios";

/**
 * Reverse Geocoding: Convert lat/lng to human-readable address
 * Uses Google Maps Geocoding API
 */
export const reverseGeocode = async (lat, lng) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    if (!apiKey) {
      console.error("❌ GOOGLE_MAPS_API_KEY not set in environment variables");
      return {
        success: false,
        address: `${lat}, ${lng}`, // Fallback to coordinates
        formattedAddress: `Lat: ${lat}, Lng: ${lng}`,
      };
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
    
    const response = await axios.get(url);
    
    if (response.data.status === "OK" && response.data.results.length > 0) {
      const result = response.data.results[0];
      
      // Extract address components
      const addressComponents = {};
      result.address_components.forEach((component) => {
        const types = component.types;
        if (types.includes("street_number")) {
          addressComponents.streetNumber = component.long_name;
        }
        if (types.includes("route")) {
          addressComponents.street = component.long_name;
        }
        if (types.includes("locality")) {
          addressComponents.city = component.long_name;
        }
        if (types.includes("administrative_area_level_1")) {
          addressComponents.state = component.long_name;
        }
        if (types.includes("country")) {
          addressComponents.country = component.long_name;
        }
        if (types.includes("postal_code")) {
          addressComponents.postalCode = component.long_name;
        }
      });

      return {
        success: true,
        formattedAddress: result.formatted_address,
        addressComponents,
        placeId: result.place_id,
        lat,
        lng,
      };
    } else {
      console.warn(`⚠️ Geocoding failed: ${response.data.status}`);
      return {
        success: false,
        address: `${lat}, ${lng}`,
        formattedAddress: `Lat: ${lat}, Lng: ${lng}`,
      };
    }
  } catch (error) {
    console.error("❌ Reverse geocoding error:", error.message);
    return {
      success: false,
      address: `${lat}, ${lng}`,
      formattedAddress: `Lat: ${lat}, ${lng}`,
    };
  }
};

/**
 * Forward Geocoding: Convert address to lat/lng
 * Uses Google Maps Geocoding API
 */
export const forwardGeocode = async (address) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    if (!apiKey) {
      console.error("❌ GOOGLE_MAPS_API_KEY not set in environment variables");
      return {
        success: false,
        error: "Geocoding service not configured",
      };
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    
    const response = await axios.get(url);
    
    if (response.data.status === "OK" && response.data.results.length > 0) {
      const result = response.data.results[0];
      const location = result.geometry.location;
      
      return {
        success: true,
        lat: location.lat,
        lng: location.lng,
        formattedAddress: result.formatted_address,
        placeId: result.place_id,
      };
    } else {
      return {
        success: false,
        error: `Geocoding failed: ${response.data.status}`,
      };
    }
  } catch (error) {
    console.error("❌ Forward geocoding error:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * ALTERNATIVE: Reverse Geocoding using OpenStreetMap (Nominatim) - FREE!
 * No API key required, but has rate limits (1 request/second)
 */
export const reverseGeocodeOSM = async (lat, lng) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'DeliveryApp/1.0' // Required by Nominatim
      }
    });
    
    if (response.data && response.data.display_name) {
      const address = response.data.address;
      
      return {
        success: true,
        formattedAddress: response.data.display_name,
        addressComponents: {
          streetNumber: address.house_number || "",
          street: address.road || "",
          city: address.city || address.town || address.village || "",
          state: address.state || "",
          country: address.country || "",
          postalCode: address.postcode || "",
        },
        lat,
        lng,
      };
    } else {
      return {
        success: false,
        address: `${lat}, ${lng}`,
        formattedAddress: `Lat: ${lat}, Lng: ${lng}`,
      };
    }
  } catch (error) {
    console.error("❌ OSM reverse geocoding error:", error.message);
    return {
      success: false,
      address: `${lat}, ${lng}`,
      formattedAddress: `Lat: ${lat}, ${lng}`,
    };
  }
};

/**
 * ALTERNATIVE: Reverse Geocoding using Mapbox - More reliable than OSM
 * Get free API key at: https://account.mapbox.com/
 */
export const reverseGeocodeMapbox = async (lat, lng) => {
  try {
    const apiKey = process.env.MAPBOX_ACCESS_TOKEN;
    
    if (!apiKey) {
      console.error("❌ MAPBOX_ACCESS_TOKEN not set in environment variables");
      return {
        success: false,
        address: `${lat}, ${lng}`,
        formattedAddress: `Lat: ${lat}, Lng: ${lng}`,
      };
    }

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${apiKey}`;
    
    const response = await axios.get(url);
    
    if (response.data.features && response.data.features.length > 0) {
      const feature = response.data.features[0];
      
      // Extract address components from context
      const addressComponents = {};
      if (feature.context) {
        feature.context.forEach((item) => {
          if (item.id.startsWith('postcode')) {
            addressComponents.postalCode = item.text;
          }
          if (item.id.startsWith('place')) {
            addressComponents.city = item.text;
          }
          if (item.id.startsWith('region')) {
            addressComponents.state = item.text;
          }
          if (item.id.startsWith('country')) {
            addressComponents.country = item.text;
          }
        });
      }

      return {
        success: true,
        formattedAddress: feature.place_name,
        addressComponents,
        lat,
        lng,
      };
    } else {
      return {
        success: false,
        address: `${lat}, ${lng}`,
        formattedAddress: `Lat: ${lat}, ${lng}`,
      };
    }
  } catch (error) {
    console.error("❌ Mapbox reverse geocoding error:", error.message);
    return {
      success: false,
      address: `${lat}, ${lng}`,
      formattedAddress: `Lat: ${lat}, ${lng}`,
    };
  }
};

/**
 * Smart Geocoder - Tries multiple services with fallback
 * Priority: Google Maps > Mapbox > OpenStreetMap > Coordinates
 */
export const smartReverseGeocode = async (lat, lng) => {
  // Try Google Maps first (if API key exists)
  if (process.env.GOOGLE_MAPS_API_KEY) {
    const result = await reverseGeocode(lat, lng);
    if (result.success) return result;
  }

  // Try Mapbox second (if API key exists)
  if (process.env.MAPBOX_ACCESS_TOKEN) {
    const result = await reverseGeocodeMapbox(lat, lng);
    if (result.success) return result;
  }

  // Try OpenStreetMap last (free, no key required)
  const result = await reverseGeocodeOSM(lat, lng);
  if (result.success) return result;

  // Final fallback: return coordinates
  return {
    success: false,
    address: `${lat}, ${lng}`,
    formattedAddress: `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`,
  };
};