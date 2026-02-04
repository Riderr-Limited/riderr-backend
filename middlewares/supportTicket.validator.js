import { body } from "express-validator";

export const createSupportTicketValidator = [
  body("issueType")
    .isIn([
      "payment issues",
      "delivery problems",
      "app technical issues",
      "account problems",
      "safety concerns",
      "other",
    ])
    .withMessage("Invalid issue type"),
  body("title")
    .isString()
    .notEmpty()
    .isLength({ max: 100 })
    .withMessage("Title is required and must be at most 100 characters"),
  body("description")
    .isString()
    .notEmpty()
    .isLength({ min: 20 })
    .withMessage("Description is required and must be at least 20 characters"),
];
