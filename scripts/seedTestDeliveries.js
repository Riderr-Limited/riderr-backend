import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import crypto from "crypto";
dotenv.config();

import User from "../models/user.models.js";
import Driver from "../models/riders.models.js";
import Company from "../models/company.models.js";
import Delivery from "../models/delivery.models.js";
import { sendNotification } from "../utils/notification.js";

const hashPwd = (p) => bcrypt.hash(p, 10);
const makeRef = () => `RID-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

const LOCATIONS = [
  { pickup: { address: "Victoria Island, Lagos", lat: 6.4281, lng: 3.4219 }, dropoff: { address: "Lekki Phase 1, Lagos", lat: 6.4698, lng: 3.5852 } },
  { pickup: { address: "Ikeja, Lagos", lat: 6.5958, lng: 3.3398 }, dropoff: { address: "Surulere, Lagos", lat: 6.5022, lng: 3.3515 } },
  { pickup: { address: "Yaba, Lagos", lat: 6.5095, lng: 3.3711 }, dropoff: { address: "Apapa, Lagos", lat: 6.4483, lng: 3.3586 } },
  { pickup: { address: "Ajah, Lagos", lat: 6.4698, lng: 3.5852 }, dropoff: { address: "Oshodi, Lagos", lat: 6.5567, lng: 3.3500 } },
  { pickup: { address: "Maryland, Lagos", lat: 6.5700, lng: 3.3600 }, dropoff: { address: "Gbagada, Lagos", lat: 6.5500, lng: 3.3900 } },
];

const CUSTOMERS = [
  { name: "Amina Bello",   email: "amina.test@riderr.ng",  phone: "08011111101" },
  { name: "Chidi Okafor",  email: "chidi.test@riderr.ng",  phone: "08011111102" },
  { name: "Fatima Yusuf",  email: "fatima.test@riderr.ng", phone: "08011111103" },
  { name: "Emeka Nwosu",   email: "emeka.test@riderr.ng",  phone: "08011111104" },
  { name: "Ngozi Adeyemi", email: "ngozi.test@riderr.ng",  phone: "08011111105" },
];

const DRIVERS = [
  { name: "Tunde Rider",  email: "tunde.driver@riderr.ng", phone: "08022221101", plate: "LAG-001-AA" },
  { name: "Seun Wheels",  email: "seun.driver@riderr.ng",  phone: "08022221102", plate: "LAG-002-BB" },
  { name: "Kola Express", email: "kola.driver@riderr.ng",  phone: "08022221103", plate: "LAG-003-CC" },
];

const notifyAdmins = async (title, message, data = {}) => {
  const admins = await User.find({ role: "admin", isActive: true }).select("_id").lean();
  await Promise.all(admins.map((admin) =>
    sendNotification({ userId: admin._id, type: "delivery", subType: "alert", title, message, data, priority: "high" })
  ));
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  console.log("Connected to MongoDB\n");

  const password = await hashPwd("Test@1234");

  // -- 1. Create or reuse test company ------------------------------------------
  console.log("Creating test company...");
  let company = await Company.findOne({ contactEmail: "test.company@riderr.ng" });
  if (!company) {
    company = await Company.create({
      name: "Riderr Test Logistics",
      businessLicense: `BL-TEST-${Date.now()}`,
      address: "12 Test Street, Lagos Island",
      city: "Lagos",
      state: "Lagos",
      lga: "Lagos Island",
      contactPhone: "08033330001",
      contactEmail: "test.company@riderr.ng",
      password: await hashPwd("Test@1234"),
      status: "active",
      isActive: true,
      location: { type: "Point", coordinates: [3.3792, 6.5244] },
    });
    console.log(`  Created company: ${company.name}`);
  } else {
    console.log(`  Company exists: ${company.name}`);
  }

  // -- 2. Create customers -------------------------------------------------------
  console.log("\nCreating test customers...");
  const customerDocs = [];
  for (const c of CUSTOMERS) {
    let user = await User.findOne({ email: c.email });
    if (!user) {
      user = await User.create({ ...c, password, role: "customer", isActive: true, isVerified: true });
      console.log(`  Created customer: ${user.name}`);
    } else {
      console.log(`  Customer exists: ${user.name}`);
    }
    customerDocs.push(user);
  }

  // -- 3. Create online drivers --------------------------------------------------
  console.log("\nCreating test drivers (online)...");
  const driverDocs = [];
  for (const d of DRIVERS) {
    let user = await User.findOne({ email: d.email });
    if (!user) {
      user = await User.create({
        name: d.name, email: d.email, phone: d.phone,
        password, role: "driver",
        companyId: company._id,
        isActive: true, isVerified: true,
      });
    }

    let driver = await Driver.findOne({ userId: user._id });
    if (!driver) {
      driver = await Driver.create({
        userId: user._id,
        companyId: company._id,
        vehicleType: "bike",
        vehicleColor: "black",
        plateNumber: d.plate,
        approvalStatus: "approved",
        isVerified: true,
        isActive: true,
        isOnline: true,
        isAvailable: true,
        currentStatus: "online",
        currentLocation: { lat: 6.5095 + Math.random() * 0.05, lng: 3.3711 + Math.random() * 0.05, updatedAt: new Date() },
        location: { type: "Point", coordinates: [3.3711 + Math.random() * 0.05, 6.5095 + Math.random() * 0.05] },
      });
      console.log(`  Created driver: ${user.name} (online)`);
    } else {
      driver.isOnline = true;
      driver.isAvailable = true;
      driver.approvalStatus = "approved";
      driver.isVerified = true;
      driver.currentStatus = "online";
      driver.currentLocation = { lat: 6.5095 + Math.random() * 0.05, lng: 3.3711 + Math.random() * 0.05, updatedAt: new Date() };
      await driver.save();
      console.log(`  Updated driver online: ${user.name}`);
    }
    driverDocs.push({ user, driver });
  }

  // -- 4. Create 5 unassigned deliveries ----------------------------------------
  console.log("\nCreating 5 test deliveries (unassigned)...");
  const deliveries = [];

  for (let i = 0; i < 5; i++) {
    const customer = customerDocs[i];
    const loc = LOCATIONS[i];
    const baseFare = 500;
    const distanceFare = Math.round(Math.random() * 1000 + 500);
    const fare = { baseFare, distanceFare, totalFare: baseFare + distanceFare, currency: "NGN" };

    const delivery = await Delivery.create({
      referenceId: makeRef(),
      customerId: customer._id,
      customerName: customer.name,
      customerPhone: customer.phone,
      recipientName: `Recipient ${i + 1}`,
      recipientPhone: `0803333${1000 + i}`,
      pickup: { ...loc.pickup, name: "Sender", phone: customer.phone },
      dropoff: { ...loc.dropoff, name: `Recipient ${i + 1}`, phone: `0803333${1000 + i}` },
      itemDetails: { type: "parcel", description: `Test package ${i + 1}`, weight: 1 },
      fare,
      estimatedDistanceKm: parseFloat((Math.random() * 10 + 2).toFixed(1)),
      estimatedDurationMin: Math.ceil(Math.random() * 30 + 10),
      payment: { method: "cash", status: "pending" },
      status: "created",
    });

    deliveries.push(delivery);
    console.log(`  Created: ${delivery.referenceId} | Fare: ${fare.totalFare.toLocaleString()} | Customer: ${customer.name}`);

    await notifyAdmins(
      "New Delivery Request",
      `New delivery #${delivery.referenceId} from ${customer.name}. Pickup: ${loc.pickup.address}. Fare: ${fare.totalFare.toLocaleString()}`,
      { type: "new_delivery", deliveryId: delivery._id, referenceId: delivery.referenceId, status: "created" }
    );

    await notifyAdmins(
      "No Drivers Available",
      `Delivery #${delivery.referenceId} has no available drivers nearby. Customer: ${customer.name}. Pickup: ${loc.pickup.address}. Fare: ${fare.totalFare.toLocaleString()}`,
      { type: "no_drivers_available", deliveryId: delivery._id, referenceId: delivery.referenceId, pickup: loc.pickup, fare }
    );
  }

  // -- 5. Summary ---------------------------------------------------------------
  console.log("\n========================================");
  console.log("SEED COMPLETE");
  console.log("========================================");
  console.log(`Company           : ${company.name}`);
  console.log(`Customers created : ${customerDocs.length}`);
  console.log(`Drivers online    : ${driverDocs.length}`);
  console.log(`Deliveries created: ${deliveries.length}`);
  console.log("\nAll passwords: Test@1234");
  console.log("\nDrivers (online & available):");
  driverDocs.forEach(({ user, driver }) => console.log(`  ${user.email}  |  driverId: ${driver._id}`));
  console.log("\nDeliveries (unassigned):");
  deliveries.forEach((d) => console.log(`  ${d.referenceId}  ->  _id: ${d._id}`));
  console.log("========================================\n");

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Seed error:", err.message);
  process.exit(1);
});
