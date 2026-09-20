import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();
import User from "./models/user.models.js";
import SupportTicket from "./models/supportTicket.model.js";

await mongoose.connect(process.env.MONGODB_URL);

const t = await SupportTicket.deleteOne({ _id: "6ab045e1e760a6f132d218a4" });
const u = await User.deleteOne({ _id: "6ab045dfe760a6f132d2189c" });

console.log(JSON.stringify({ deletedTicket: t.deletedCount, deletedUser: u.deletedCount }));
await mongoose.disconnect();
