import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/company.models.js";

dotenv.config();

const approveBankDetails = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL || "mongodb://127.0.0.1:27017/riderr_db");
    console.log("🔗 Connected to database");

    const result = await Company.updateMany(
      { "bankDetails.accountNumber": { $exists: true, $ne: null, $ne: "" } },
      {
        $set: {
          "bankDetails.verified": true,
          "bankDetails.verifiedAt": new Date(),
        },
      }
    );

    console.log(`✅ Approved bank details for ${result.modifiedCount} company/companies`);
    console.log(`   (${result.matchedCount} matched, ${result.modifiedCount} updated)`);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from database");
  }
};

approveBankDetails();
