/**
 * ═══════════════════════════════════════════════════════════════════
 * DELIVERY MODEL — RESCUE FIELDS
 * Add these fields to your existing Delivery mongoose schema
 * ═══════════════════════════════════════════════════════════════════
 *
 * In your delivery.models.js, add the following to the schema
 * definition object (alongside your existing fields):
 *
 * ─── 1. Add "rescue_requested" to your status enum ─────────────────
 *
 *   status: {
 *     type: String,
 *     enum: [
 *       "created",
 *       "assigned",
 *       "picked_up",
 *       "in_transit",
 *       "delivered",
 *       "cancelled",
 *       "failed",
 *       "rescue_requested",   // ← ADD THIS
 *     ],
 *     default: "created",
 *   },
 *
 * ─── 2. Add rescueRequest sub-document ─────────────────────────────
 *
 *   rescueRequest: {
 *     status: {
 *       type: String,
 *       enum: ["pending", "resolved", "dismissed"],
 *       default: "pending",
 *     },
 *     reason: { type: String },
 *     details: { type: String },
 *     requestedAt: { type: Date },
 *     requestedByDriverId: { type: mongoose.Schema.Types.ObjectId, ref: "Driver" },
 *     driverLocation: {
 *       lat: { type: Number },
 *       lng: { type: Number },
 *     },
 *     resolvedAt: { type: Date },
 *     resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
 *     resolution: {
 *       type: String,
 *       enum: ["reassigned_to_new_driver", "dismissed"],
 *     },
 *     note: { type: String },
 *   },
 *
 * ─── 3. Add reassignmentHistory array ──────────────────────────────
 *
 *   reassignmentHistory: [
 *     {
 *       previousDriverId: { type: mongoose.Schema.Types.ObjectId, ref: "Driver" },
 *       newDriverId:      { type: mongoose.Schema.Types.ObjectId, ref: "Driver" },
 *       reassignedAt:     { type: Date },
 *       reassignedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User" },
 *       reason:           { type: String },
 *       note:             { type: String },
 *     },
 *   ],
 *
 * ═══════════════════════════════════════════════════════════════════
 * EXAMPLE — Complete snippet to paste into your schema:
 * ═══════════════════════════════════════════════════════════════════
 */

import mongoose from "mongoose";

// Paste this sub-schema snippet into your existing deliverySchema:
export const rescueFields = {
  rescueRequest: {
    status: {
      type: String,
      enum: ["pending", "resolved", "dismissed"],
    },
    reason: { type: String },
    details: { type: String },
    requestedAt: { type: Date },
    requestedByDriverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
    },
    driverLocation: {
      lat: { type: Number },
      lng: { type: Number },
    },
    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolution: {
      type: String,
      enum: ["reassigned_to_new_driver", "dismissed"],
    },
    note: { type: String },
  },

  reassignmentHistory: [
    {
      previousDriverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Driver",
      },
      newDriverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Driver",
      },
      reassignedAt: { type: Date },
      reassignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reason: { type: String },
      note: { type: String },
    },
  ],
};

/**
 * ═══════════════════════════════════════════════════════════════════
 * HOW TO APPLY: In your delivery.models.js file
 * ═══════════════════════════════════════════════════════════════════
 *
 * Option A — Spread into existing schema (cleanest):
 *
 *   import { rescueFields } from "./rescue.schema.js";
 *
 *   const deliverySchema = new mongoose.Schema({
 *     // ...all your existing fields...
 *     ...rescueFields,
 *   }, { timestamps: true });
 *
 *
 * Option B — Manual copy-paste:
 *   Just copy the two field blocks above directly into your schema.
 *
 * ═══════════════════════════════════════════════════════════════════
 * ALSO update the status enum in your existing schema:
 * ═══════════════════════════════════════════════════════════════════
 *
 *   status: {
 *     type: String,
 *     enum: [
 *       "created", "assigned", "picked_up",
 *       "in_transit", "delivered", "cancelled",
 *       "failed",
 *       "rescue_requested",   // ← add this line
 *     ],
 *     default: "created",
 *   },
 */