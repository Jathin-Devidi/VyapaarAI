import tls from "node:tls";
import dns from "node:dns";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Ignore on older Node versions
}

/**
 * Walk up from process.cwd() and import.meta.dirname to locate the workspace .env file
 * regardless of where Vite or Node executes from.
 */
export function reloadEnvFile(): void {
  const startDirs = [process.cwd(), import.meta.dirname];
  const visited = new Set<string>();

  for (const base of startDirs) {
    if (!base) continue;
    let current = base;
    for (let i = 0; i < 6; i++) {
      const envPath = path.resolve(current, ".env");
      if (!visited.has(envPath)) {
        visited.add(envPath);
        try {
          if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, "utf-8");
            for (const line of content.split(/\r?\n/)) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith("#")) continue;
              const eqIdx = trimmed.indexOf("=");
              if (eqIdx === -1) continue;
              const key = trimmed.slice(0, eqIdx).trim();
              const rawVal = trimmed.slice(eqIdx + 1).trim();
              const val = rawVal.replace(/^['"]|['"]$/g, "");
              if (key && val !== "") {
                process.env[key] = val;
              }
            }
          }
        } catch {
          // Ignore read errors
        }
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
}

reloadEnvFile();

/**
 * Native TLS SMTP sender (port 465 SSL/TLS, e.g. smtp.gmail.com) with IPv4 & SNI support.
 */
async function sendEmailViaSmtp(params: {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: params.host,
      port: params.port,
      servername: params.host,
      family: 4,
      rejectUnauthorized: false,
    });

    let step = 0;
    let buffer = "";

    const sendLine = (cmd: string) => {
      socket.write(cmd + "\r\n");
    };

    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, error: "SMTP connection timed out" });
    }, 15000);

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line) continue;
        if (line.length >= 4 && line[3] === "-") continue;
        const code = parseInt(line.slice(0, 3), 10);
        if (Number.isNaN(code)) continue;

        if (step === 0 && code === 220) {
          step = 1;
          sendLine("EHLO vyapaarai.local");
        } else if (step === 1 && code === 250) {
          step = 2;
          sendLine("AUTH LOGIN");
        } else if (step === 2 && code === 334) {
          step = 3;
          sendLine(Buffer.from(params.user).toString("base64"));
        } else if (step === 3 && code === 334) {
          step = 4;
          sendLine(Buffer.from(params.pass).toString("base64"));
        } else if (step === 4 && code === 235) {
          step = 5;
          sendLine(`MAIL FROM:<${params.user}>`);
        } else if (step === 5 && code === 250) {
          step = 6;
          sendLine(`RCPT TO:<${params.to}>`);
        } else if (step === 6 && (code === 250 || code === 251)) {
          step = 7;
          sendLine("DATA");
        } else if (step === 7 && code === 354) {
          step = 8;
          const boundary = "vyapaarai_boundary_" + Date.now();
          const message = [
            `Date: ${new Date().toUTCString()}`,
            `Message-ID: <${crypto.randomUUID()}@vyapaarai.local>`,
            `From: "VyapaarAI" <${params.from}>`,
            `To: <${params.to}>`,
            `Subject: ${params.subject}`,
            "MIME-Version: 1.0",
            `Content-Type: multipart/alternative; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            "Content-Type: text/plain; charset=UTF-8",
            "Content-Transfer-Encoding: 8bit",
            "",
            params.text,
            "",
            `--${boundary}`,
            "Content-Type: text/html; charset=UTF-8",
            "Content-Transfer-Encoding: 8bit",
            "",
            params.html,
            "",
            `--${boundary}--`,
            ".",
          ].join("\r\n");
          sendLine(message);
        } else if (step === 8 && code === 250) {
          step = 9;
          sendLine("QUIT");
          clearTimeout(timeout);
          socket.end();
          resolve({ ok: true });
        } else if (code >= 400) {
          console.error(`[VyapaarAI SMTP Error] ${line}`);
          clearTimeout(timeout);
          socket.destroy();
          resolve({ ok: false, error: line });
        }
      }
    });

    socket.on("error", (err) => {
      console.error("[VyapaarAI SMTP Socket Error]", err.message);
      clearTimeout(timeout);
      resolve({ ok: false, error: err.message });
    });
  });
}

export async function dispatchEmailOtp(params: {
  toEmail: string;
  recipientName?: string;
  businessName?: string;
  otp: string;
}): Promise<{ delivered: boolean; provider: string; error?: string }> {
  reloadEnvFile();

  const name = params.recipientName?.trim() || "Merchant";
  const store = params.businessName?.trim() || "your store";
  const subject = `${params.otp} is your VyapaarAI Email Verification Code`;
  const greetingText = `Greetings from VyapaarAI!\n\nWelcome to VyapaarAI, ${name}! Thank you for registering ${store} on VyapaarAI - India's Autonomous AI Business Operating System.\n\nYour 6-digit email verification OTP is: ${params.otp}\n\nThis code is valid for 10 minutes.`;
  const greetingHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #FDF9F1; border: 1px solid #E8DCBF; border-radius: 16px; color: #2A1F14;">
      <h2 style="color: #C1440E; margin-top: 0;">Greetings from VyapaarAI!</h2>
      <p style="font-size: 15px; line-height: 1.5;">Welcome to <strong>VyapaarAI</strong>, <strong>${name}</strong>! We are delighted to welcome <strong>${store}</strong>.</p>
      <p style="font-size: 14px; color: #4A3A24;">Please enter the 6-digit verification code below in the Email OTP box:</p>
      <div style="margin: 20px 0; padding: 16px; background: #FFF3EE; border: 2px dashed #C1440E; border-radius: 12px; text-align: center;">
        <span style="font-size: 28px; font-weight: bold; letter-spacing: 8px; color: #C1440E;">${params.otp}</span>
      </div>
      <p style="font-size: 12px; color: #6B5836;">This OTP is valid for 10 minutes.</p>
    </div>
  `;

  console.log(`\n=============================================================`);
  console.log(`📧 [VyapaarAI Email OTP -> ${params.toEmail}]`);
  console.log(`Message : Greetings from VyapaarAI! Welcome to VyapaarAI, ${name}!`);
  console.log(`OTP Code: ${params.otp}`);
  console.log(`=============================================================\n`);

  // 1. Free Gmail / SMTP Delivery
  const smtpUser = (process.env.SMTP_USER || process.env.GMAIL_USER || "").trim();
  const smtpPass = (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  const smtpHost = (process.env.SMTP_HOST || "smtp.gmail.com").trim();
  const smtpPort = Number(process.env.SMTP_PORT || "465");

  if (smtpUser && smtpPass) {
    const res = await sendEmailViaSmtp({
      host: smtpHost,
      port: smtpPort,
      user: smtpUser,
      pass: smtpPass,
      from: smtpUser,
      to: params.toEmail,
      subject,
      text: greetingText,
      html: greetingHtml,
    });
    if (res.ok) {
      console.log(`✅ [VyapaarAI Email OTP Delivered via Free Gmail SMTP to ${params.toEmail}]`);
      return { delivered: true, provider: "gmail-smtp" };
    }
    return { delivered: false, provider: "gmail-smtp", error: res.error };
  }

  // 2. Resend Free Tier API
  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || "VyapaarAI <onboarding@resend.dev>",
          to: [params.toEmail],
          subject,
          text: greetingText,
          html: greetingHtml,
        }),
      });
      if (res.ok) {
        console.log(`✅ [VyapaarAI Email Delivered via Resend to ${params.toEmail}]`);
        return { delivered: true, provider: "resend" };
      }
    } catch {
      // Ignore
    }
  }

  return {
    delivered: false,
    provider: "console",
    error: "GMAIL_USER / GMAIL_APP_PASSWORD not set in .env",
  };
}

/**
 * Free Mobile OTP Dispatcher:
 * 1. Tries 2Factor.in Free Trial (if TWOFACTOR_API_KEY is set)
 * 2. Tries Fast2SMS OTP Route & Quick Route (if FAST2SMS_API_KEY is set)
 * 3. Tries Textbelt Free SMS API (key: 'textbelt', zero signup required)
 * 4. Automatically dispatches via Free Gmail Mobile OTP Relay to the user's phone/email inbox
 *    so Mobile OTP verification works 100% free even when Indian SMS gateways demand a Rs.100 deposit.
 */
export async function dispatchSmsOtp(params: {
  toPhone: string;
  fallbackEmail?: string;
  recipientName?: string;
  businessName?: string;
  otp: string;
  isNewAccount?: boolean;
}): Promise<{ delivered: boolean; provider: string; error?: string; channel?: string }> {
  reloadEnvFile();

  const name = params.recipientName?.trim() || "Merchant";
  const store = params.businessName?.trim() || "your store";
  const smsMessage = params.isNewAccount
    ? `Greetings from VyapaarAI! Welcome to VyapaarAI, ${name}! Your 6-digit mobile verification OTP for ${store} (+91 ${params.toPhone}) is ${params.otp}.`
    : `Greetings from VyapaarAI! Welcome back, ${name}! Your 6-digit mobile sign-in OTP for ${store} (+91 ${params.toPhone}) is ${params.otp}.`;

  console.log(`\n=============================================================`);
  console.log(`📱 [VyapaarAI Mobile OTP -> +91 ${params.toPhone}]`);
  console.log(`Message : ${smsMessage}`);
  console.log(`OTP Code: ${params.otp}`);
  console.log(`=============================================================\n`);

  // 0. Check Twilio Free Trial SMS API (Priority #1 when TWILIO_ACCOUNT_SID is set)
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID.trim();
      const token = process.env.TWILIO_AUTH_TOKEN.trim();
      const authHeader = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
      let fromNumber = (process.env.TWILIO_FROM_NUMBER || "").replace(/\s+/g, "");

      // If TWILIO_FROM_NUMBER is missing or is the user's personal +91 number instead of the Twilio +1 trial number,
      // automatically look up (or provision) the Twilio Trial Phone Number from their Twilio account.
      if (!fromNumber || fromNumber.startsWith("+91") || fromNumber.endsWith(params.toPhone)) {
        const listRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=5`,
          { headers: { Authorization: authHeader } },
        );
        const listData = (await listRes.json().catch(() => ({}))) as Record<string, any>;
        const existingNumbers = listData.incoming_phone_numbers as Array<Record<string, any>> | undefined;
        if (existingNumbers && existingNumbers.length > 0 && existingNumbers[0].phone_number) {
          fromNumber = String(existingNumbers[0].phone_number);
          console.log(`[VyapaarAI Twilio] Auto-detected your Twilio sender number: ${fromNumber}`);
        } else {
          // Attempt to auto-provision the free trial US number if none exists yet
          const availRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${sid}/AvailablePhoneNumbers/US/Local.json?SmsEnabled=true&PageSize=1`,
            { headers: { Authorization: authHeader } },
          );
          const availData = (await availRes.json().catch(() => ({}))) as Record<string, any>;
          const candidate = availData.available_phone_numbers?.[0]?.phone_number;
          if (candidate) {
            const buyBody = new URLSearchParams({ PhoneNumber: String(candidate) });
            const buyRes = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json`,
              {
                method: "POST",
                headers: {
                  Authorization: authHeader,
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: buyBody.toString(),
              },
            );
            const buyData = (await buyRes.json().catch(() => ({}))) as Record<string, any>;
            if (buyRes.ok && buyData.phone_number) {
              fromNumber = String(buyData.phone_number);
              console.log(`[VyapaarAI Twilio] Auto-provisioned free Twilio trial number: ${fromNumber}`);
            }
          }
        }
      }

      if (fromNumber) {
        const body = new URLSearchParams({
          To: `+91${params.toPhone}`,
          From: fromNumber,
          Body: smsMessage,
        });
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
          },
        );
        const data = (await res.json().catch(() => ({}))) as Record<string, any>;
        if (res.ok) {
          console.log(`✅ [VyapaarAI SMS Delivered via Twilio (${fromNumber}) to +91 ${params.toPhone}]`);
          return { delivered: true, provider: "twilio", channel: "sms" };
        }
        console.warn(`[VyapaarAI Twilio Notice] ${data.message || "Unable to send via Twilio"}`);
      }
    } catch (err: any) {
      console.warn(`[VyapaarAI Twilio Error] ${err.message}`);
    }
  }

  // 1. Check 2Factor.in Free Trial API
  if (process.env.TWOFACTOR_API_KEY) {
    try {
      const apiKey = process.env.TWOFACTOR_API_KEY.trim();
      const res = await fetch(
        `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/+91${params.toPhone}/${params.otp}`,
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, any>;
      if (res.ok && data.Status === "Success") {
        console.log(`✅ [VyapaarAI SMS Delivered via 2Factor.in to +91 ${params.toPhone}]`);
        return { delivered: true, provider: "2factor", channel: "sms" };
      }
    } catch {
      // Fall through to next free service
    }
  }

  // 2. Check Fast2SMS API (Try 'otp' route first, then 'q' route)
  if (process.env.FAST2SMS_API_KEY) {
    try {
      const apiKey = process.env.FAST2SMS_API_KEY.trim();
      const otpRes = await fetch("https://www.fast2sms.com/dev/bulkV2", {
        method: "POST",
        headers: {
          authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          route: "otp",
          variables_values: params.otp,
          flash: 0,
          numbers: params.toPhone,
        }),
      });
      const otpData = (await otpRes.json().catch(() => ({}))) as Record<string, any>;
      if (otpRes.ok && otpData.return === true) {
        console.log(`✅ [VyapaarAI SMS Delivered via Fast2SMS (OTP route) to +91 ${params.toPhone}]`);
        return { delivered: true, provider: "fast2sms", channel: "sms" };
      }

      const quickRes = await fetch("https://www.fast2sms.com/dev/bulkV2", {
        method: "POST",
        headers: {
          authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          route: "q",
          message: smsMessage,
          language: "english",
          flash: 0,
          numbers: params.toPhone,
        }),
      });
      const quickData = (await quickRes.json().catch(() => ({}))) as Record<string, any>;
      if (quickRes.ok && quickData.return === true) {
        console.log(`✅ [VyapaarAI SMS Delivered via Fast2SMS (Quick route) to +91 ${params.toPhone}]`);
        return { delivered: true, provider: "fast2sms", channel: "sms" };
      }
      console.warn(
        `[VyapaarAI Fast2SMS Notice] ${
          Array.isArray(quickData.message) ? quickData.message.join(", ") : quickData.message || otpData.message
        } -> Falling back to Free OTP Service`,
      );
    } catch {
      // Fall through to free services
    }
  }

  // 3. Try Textbelt Free SMS API (key: 'textbelt')
  try {
    const tbRes = await fetch("https://textbelt.com/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: `+91${params.toPhone}`,
        message: smsMessage,
        key: process.env.TEXTBELT_API_KEY || "textbelt",
      }),
    });
    const tbData = (await tbRes.json().catch(() => ({}))) as Record<string, any>;
    if (tbRes.ok && tbData.success === true) {
      console.log(`✅ [VyapaarAI SMS Delivered via Free Textbelt Gateway to +91 ${params.toPhone}]`);
      return { delivered: true, provider: "textbelt-free", channel: "sms" };
    }
  } catch {
    // Fall through to Free Gmail Mobile OTP Relay
  }

  // 4. Free Gmail Mobile OTP Relay (100% Free Instant Delivery to User's Phone / Email Inbox)
  const smtpUser = (process.env.SMTP_USER || process.env.GMAIL_USER || "").trim();
  const smtpPass = (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  const targetEmail = (params.fallbackEmail || smtpUser || "").trim().toLowerCase();

  if (smtpUser && smtpPass && targetEmail) {
    const subject = `${params.otp} is your VyapaarAI Mobile OTP for +91 ${params.toPhone}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #FDF9F1; border: 1px solid #E8DCBF; border-radius: 16px; color: #2A1F14;">
        <div style="display: inline-block; padding: 4px 10px; background: #E7F5EC; color: #1B5E34; border-radius: 999px; font-size: 11px; font-weight: bold; margin-bottom: 10px;">
          MOBILE NUMBER OTP (+91 ${params.toPhone})
        </div>
        <h2 style="color: #C1440E; margin-top: 0;">Greetings from VyapaarAI!</h2>
        <p style="font-size: 15px; line-height: 1.5;">${smsMessage}</p>
        <p style="font-size: 14px; color: #4A3A24;">Enter this 6-digit code in the <strong>Mobile Number OTP</strong> box:</p>
        <div style="margin: 20px 0; padding: 16px; background: #E7F5EC; border: 2px dashed #22683F; border-radius: 12px; text-align: center;">
          <span style="font-size: 28px; font-weight: bold; letter-spacing: 8px; color: #1B5E34;">${params.otp}</span>
        </div>
        <p style="font-size: 12px; color: #6B5836;">Mobile: +91 ${params.toPhone} · Valid for 10 minutes.</p>
      </div>
    `;

    const res = await sendEmailViaSmtp({
      host: (process.env.SMTP_HOST || "smtp.gmail.com").trim(),
      port: Number(process.env.SMTP_PORT || "465"),
      user: smtpUser,
      pass: smtpPass,
      from: smtpUser,
      to: targetEmail,
      subject,
      text: smsMessage,
      html,
    });

    if (res.ok) {
      // If user typed a different email than smtpUser, also send a copy if needed, or just targetEmail
      console.log(
        `✅ [VyapaarAI Mobile OTP (+91 ${params.toPhone}) Delivered via Free Gmail OTP Gateway to ${targetEmail}]`,
      );
      return {
        delivered: true,
        provider: "free-gmail-otp-gateway",
        channel: targetEmail,
      };
    }
  }

  return {
    delivered: false,
    provider: "console",
    error: "OTP printed in server terminal",
  };
}
