import nodemailer from "nodemailer";

// Simple email sender without complex templates
export const sendVerificationEmail = async (email, name, token) => {
  try {
    let transporter;

    if (process.env.NODE_ENV === "production") {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT),
        secure: false,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD,
        },
        tls: { 
          rejectUnauthorized: false 
        },
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 30000,
      });
    } else {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
    }

    const verificationLink = `${process.env.FRONTEND_URL}/verify-email/${token}`;

    await transporter.sendMail({
      from: `"Riderr" <${process.env.EMAIL_FROM || "noreply@riderr.com"}>`,
      to: email,
      subject: "Verify Your Email Address",
      html: `
        <h2>Welcome to Riderr, ${name}!</h2>
        <p>Please verify your email:</p>
        <a href="${verificationLink}">Verify Email</a>
      `,
    });

    return true;
  } catch (err) {
    console.error("❌ Email sending error:", err.message);
    return false;
  }
};
