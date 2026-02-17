import express from 'express';
import { submitContactForm, getContactMessages, updateContactStatus } from '../controllers/contact.controller.js';
import authenticate from '../middlewares/authenticate.js';
import authorizeRole from '../middlewares/authorizeRole.js';

const router = express.Router();

// Public route
router.post('/', submitContactForm);

// Admin routes
router.get('/', authenticate, authorizeRole('admin'), getContactMessages);
router.patch('/:id/status', authenticate, authorizeRole('admin'), updateContactStatus);

export default router;
