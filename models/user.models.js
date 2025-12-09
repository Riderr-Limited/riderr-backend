import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["customer", "company_admin", "rider", "admin"],
      required: true,
      index: true
    },

    name: { type: String, required: true },

    email: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    password: {
      type: String,
      required: true,
    },

    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true,
    },

    avatarUrl: String,

    isVerified: {
      type: Boolean,
      default: false,
    },

    lastSeenAt: Date,

    meta: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);
export default User;
