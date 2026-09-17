import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import User from '../models/user.models.js';
import Driver from '../models/riders.models.js';
import Delivery from '../models/delivery.models.js';

await mongoose.connect(process.env.MONGODB_URL);

console.log('\n=== DRIVERS ===');
const drivers = await Driver.find({})
  .populate('userId', 'name phone isActive')
  .select('_id isActive isVerified approvalStatus isOnline isAvailable isSuspended plateNumber currentDeliveryId companyId')
  .lean();

drivers.forEach(d => {
  console.log(`_id        : ${d._id}`);
  console.log(`name       : ${d.userId?.name}`);
  console.log(`isActive   : ${d.isActive} | isVerified: ${d.isVerified} | approvalStatus: ${d.approvalStatus}`);
  console.log(`isOnline   : ${d.isOnline} | isAvailable: ${d.isAvailable} | isSuspended: ${d.isSuspended}`);
  console.log(`activeJob  : ${d.currentDeliveryId || 'none'}`);
  console.log('---');
});

console.log('\n=== UNASSIGNED DELIVERIES ===');
const deliveries = await Delivery.find({ status: 'created' })
  .select('_id referenceId status driverId customerName')
  .lean();

deliveries.forEach(d => {
  console.log(`_id        : ${d._id}`);
  console.log(`referenceId: ${d.referenceId}`);
  console.log(`status     : ${d.status}`);
  console.log(`driverId   : ${d.driverId || 'none'}`);
  console.log('---');
});

await mongoose.disconnect();
