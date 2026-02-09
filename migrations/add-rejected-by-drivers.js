/**
 * Migration Script: Add rejectedByDrivers field to existing deliveries
 * 
 * Run this ONCE after updating your Delivery model
 * 
 * How to run:
 * 1. Save this as: migrations/add-rejected-by-drivers.js
 * 2. Run: node migrations/add-rejected-by-drivers.js
 */

import mongoose from 'mongoose';
import Delivery from '../models/delivery.models.js'; // Adjust path as needed

// Your MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/your-database-name';

async function migrateDeliveries() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Count deliveries that need migration
    const count = await Delivery.countDocuments({
      rejectedByDrivers: { $exists: false }
    });

    console.log(`📊 Found ${count} deliveries without rejectedByDrivers field`);

    if (count === 0) {
      console.log('✅ All deliveries already have the field. No migration needed.');
      process.exit(0);
    }

    // Add empty rejectedByDrivers array to all deliveries that don't have it
    const result = await Delivery.updateMany(
      { rejectedByDrivers: { $exists: false } },
      { $set: { rejectedByDrivers: [] } }
    );

    console.log(`✅ Migration complete!`);
    console.log(`   - Updated: ${result.modifiedCount} deliveries`);
    console.log(`   - Matched: ${result.matchedCount} deliveries`);

    // Verify migration
    const remaining = await Delivery.countDocuments({
      rejectedByDrivers: { $exists: false }
    });

    if (remaining === 0) {
      console.log('✅ Verification passed: All deliveries now have rejectedByDrivers field');
    } else {
      console.log(`⚠️  Warning: ${remaining} deliveries still missing the field`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateDeliveries();