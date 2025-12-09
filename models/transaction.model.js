const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    deliveryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Delivery",
      required: true,
      index: true,
    },

    amount: { type: Number, required: true },

    currency: { type: String, default: "NGN" },

    gateway: {
      type: String,
      enum: ["paystack", "flutterwave"],
      required: true,
    },

    gatewayTxnRef: {
      type: String,
      required: true,
      unique: true,
    },

    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },

    metadata: Object,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", TransactionSchema);
