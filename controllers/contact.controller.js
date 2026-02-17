import Contact from '../models/contact.model.js';
import nodemailer from 'nodemailer';

export const submitContactForm = async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const contact = await Contact.create({
      name,
      email,
      subject,
      message,
      ipAddress: req.ip
    });

    // Send email notification
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    const emailContent = `
New Contact Form Submission

Name: ${name}
Email: ${email}
Subject: ${subject}

Message:
${message}

---
Submitted at: ${new Date().toLocaleString()}
IP Address: ${req.ip}
    `.trim();

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: ['contact@riderr.ng', 'usmanmasudaliyu@riderr.ng'],
      subject: `Contact Form: ${subject}`,
      text: emailContent,
      replyTo: email
    });

    res.status(201).json({
      success: true,
      message: 'Message sent successfully! We will get back to you soon.',
      data: { id: contact._id }
    });
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message. Please try again later.'
    });
  }
};

export const getContactMessages = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = status ? { status } : {};
    
    const messages = await Contact.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Contact.countDocuments(query);

    res.json({
      success: true,
      data: messages,
      pagination: { total, page: +page, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateContactStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const contact = await Contact.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    );

    if (!contact) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    res.json({ success: true, data: contact });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
