// Create a test script test-db.js
import mongoose from 'mongoose';
import Delivery from './models/delivery.models.js';
import Driver from './models/riders.models.js';

async function testDatabase() {
  try {
    await mongoose.connect('mongodb://localhost:27017/riderr');
    console.log('✅ Connected to MongoDB');
    
    // Check existing deliveries
    const deliveries = await Delivery.find({}).limit(5);
    console.log(`📦 Found ${deliveries.length} deliveries:`);
    deliveries.forEach(d => console.log(`  - ID: ${d._id}, ReferenceID: ${d.referenceId || 'null'}`));
    
    // Check existing drivers
    const drivers = await Driver.find({}).limit(5);
    console.log(`🚗 Found ${drivers.length} drivers:`);
    drivers.forEach(d => console.log(`  - ID: ${d._id}, UserID: ${d.userId}`));
    
    // Check for duplicate referenceIds
    const dupReferenceIds = await Delivery.aggregate([
      { $match: { referenceId: { $ne: null } } },
      { $group: { _id: "$referenceId", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]);
    
    console.log(`🔍 Found ${dupReferenceIds.length} duplicate referenceIds`);
    
    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testDatabase();