// services/kyc/providers/mock.provider.js
// Fake identity provider for development and testing. Makes no network calls
// and costs nothing. Refuses to run in production (see services/kyc/index.js).
//
// Test NINs (11 digits):
//   00000000000  -> NIN not found
//   11111111111  -> found, but name does NOT match (goes to failed)
//   22222222222  -> selfie does NOT match the NIN photo
//   33333333333  -> liveness fails (photo of a photo)
//   anything else -> found, name copied from `hintName`, all checks pass

const split = (fullName = "") => {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "Test",
    middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
    lastName: parts.length > 1 ? parts[parts.length - 1] : "User"
  };
};

export default {
  name: "mock",

  async lookupNin(nin, { hintName } = {}) {
    if (nin === "00000000000") return { found: false };
    const name = nin === "11111111111" ? split("Chukwuemeka Obi") : split(hintName);
    return {
      found: true,
      ...name,
      dateOfBirth: "1995-01-01",
      gender: "M",
      phone: null,
      providerRef: `mock-nin-${Date.now()}`
    };
  },

  async checkLiveness() {
    return { live: true, score: 0.97, providerRef: `mock-live-${Date.now()}` };
  },

  async matchSelfieToNin(nin) {
    if (nin === "33333333333") {
      return { live: false, livenessScore: 0.12, match: false, matchScore: 0, providerRef: "mock-face" };
    }
    if (nin === "22222222222") {
      return { live: true, livenessScore: 0.95, match: false, matchScore: 0.21, providerRef: "mock-face" };
    }
    return { live: true, livenessScore: 0.96, match: true, matchScore: 0.93, providerRef: `mock-face-${Date.now()}` };
  }
};
