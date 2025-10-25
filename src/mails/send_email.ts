import nodemailer from "nodemailer";

// For development - uses ethereal email (fake SMTP)
export const createDevTransporter = async () => {
  const testAccount = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
};

export const sendEmail = async ({ to, subject, html }) => {
  const transporter = await createDevTransporter();

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || '"Your App" <noreply@yourapp.com>',
    to,
    subject,
    html,
  });

  // In dev, log the preview URL
  if (process.env.NODE_ENV !== "production") {
    console.log("Preview URL:", nodemailer.getTestMessageUrl(info));
  }

  return info;
};
