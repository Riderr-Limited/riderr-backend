import { Router } from "express";
import {
  createRider,
  getCompanyRiders,
  deleteRider
} from "../controllers/user.controller.js"; 
import  authorize  from "../middlewares/authorize.js";
import { isCompanyAdmin } from "../middlewares/isCompanyAdmin.js";

const router = Router();

// Company Admin → Create Rider
router.post("/:companyId/riders", authorize, isCompanyAdmin, createRider);

// Company Admin → List Riders
router.get("/:companyId/riders", authorize, isCompanyAdmin, getCompanyRiders);

// Company Admin → Delete Rider
router.delete("/:companyId/riders/:riderId", authorize, isCompanyAdmin, deleteRider);

export default router;
