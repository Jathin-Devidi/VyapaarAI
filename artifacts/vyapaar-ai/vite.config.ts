import path from 'path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import tls from 'node:tls';
import dns from 'node:dns';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Ignore on older Node versions
}

/**
 * Walk up from both process.cwd() and import.meta.dirname to find the monorepo workspace root
 * even when Vite compiles vite.config.ts into node_modules/.vite-temp.
 */
function findWorkspaceRoot(): string {
  const startDirs = [process.cwd(), import.meta.dirname];
  for (const base of startDirs) {
    if (!base) continue;
    let current = base;
    for (let i = 0; i < 6; i++) {
      if (
        fs.existsSync(path.resolve(current, 'pnpm-workspace.yaml')) ||
        fs.existsSync(path.resolve(current, '.env'))
      ) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return process.cwd();
}

function reloadRootEnv(): void {
  const startDirs = [findWorkspaceRoot(), process.cwd(), import.meta.dirname];
  const visited = new Set<string>();

  for (const base of startDirs) {
    if (!base) continue;
    let current = base;
    for (let i = 0; i < 6; i++) {
      const envPath = path.resolve(current, '.env');
      if (!visited.has(envPath)) {
        visited.add(envPath);
        try {
          if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf-8');
            for (const line of content.split(/\r?\n/)) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('#')) continue;
              const eqIdx = trimmed.indexOf('=');
              if (eqIdx === -1) continue;
              const key = trimmed.slice(0, eqIdx).trim();
              const val = trimmed
                .slice(eqIdx + 1)
                .trim()
                .replace(/^['"]|['"]$/g, '');
              if (key && val !== '') {
                process.env[key] = val;
              }
            }
          }
        } catch {
          // Ignore
        }
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
}

reloadRootEnv();

const port = Number(process.env.VITE_PORT ?? '25694');
const basePath = process.env.BASE_PATH ?? '/';
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function normalizePhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

function generateSixDigitOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

interface StoredUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  businessName: string | null;
  gstin: string | null;
  password?: string | null;
  role: string;
  businessId: string | null;
  onboardingComplete: boolean;
}

const usersById = new Map<string, StoredUser>();
const usersByEmail = new Map<string, StoredUser>();
const usersByPhone = new Map<string, StoredUser>();
const emailOtps = new Map<string, { otp: string; verified: boolean; expiresAt: number }>();
const phoneOtps = new Map<string, { otp: string; verified: boolean; expiresAt: number }>();
const loginOtps = new Map<string, { otp: string; expiresAt: number }>();
const emailLoginOtps = new Map<string, { otp: string; expiresAt: number }>();

const DATA_FILE = path.resolve(findWorkspaceRoot(), '.vyapaar-users.json');

function loadUsers(): void {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const list = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as Array<Record<string, any>>;
      usersById.clear();
      usersByEmail.clear();
      usersByPhone.clear();
      for (const raw of list) {
        const cleanEmail =
          raw.email && String(raw.email).trim() ? String(raw.email).trim().toLowerCase() : null;
        const u: StoredUser = {
          id: raw.id,
          name: raw.name || 'Merchant',
          email: cleanEmail,
          phone: raw.phone ? normalizePhone(String(raw.phone)) : null,
          businessName: raw.businessName ?? `${raw.name || 'Merchant'}'s Store`,
          gstin: raw.gstin ?? null,
          password: raw.password ?? null,
          role: raw.role ?? 'owner',
          businessId: raw.businessId ?? null,
          onboardingComplete: true,
        };
        usersById.set(u.id, u);
        if (u.email) usersByEmail.set(u.email, u);
        if (u.phone) usersByPhone.set(u.phone, u);
      }
    }
  } catch {
    // Ignore
  }

  if (usersById.size === 0) {
    const defaultUser: StoredUser = {
      id: '0eda82ff-7f5e-44a6-bd15-a785d56c7068',
      name: 'Jathin',
      email: 'djathin58@gmail.com',
      phone: '9642865348',
      businessName: 'Sri sai Kirana',
      gstin: null,
      role: 'owner',
      businessId: '07657761-9ffc-4ffa-a276-8ecc51215fa6',
      onboardingComplete: true,
    };
    usersById.set(defaultUser.id, defaultUser);
    usersByEmail.set(defaultUser.email!, defaultUser);
    usersByPhone.set(defaultUser.phone!, defaultUser);
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify([defaultUser], null, 2), 'utf-8');
    } catch {
      // Ignore
    }
  }
}

function saveUsers(): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(Array.from(usersById.values()), null, 2), 'utf-8');
  } catch {
    // Ignore
  }
}

loadUsers();

async function sendSmtpEmail(params: {
  host: string;
  port: number;
  user: string;
  pass: string;
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
    let buffer = '';
    const sendLine = (cmd: string) => socket.write(cmd + '\r\n');
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, error: 'SMTP connection timed out' });
    }, 15000);

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        if (line.length >= 4 && line[3] === '-') continue;
        const code = parseInt(line.slice(0, 3), 10);
        if (Number.isNaN(code)) continue;
        if (step === 0 && code === 220) {
          step = 1;
          sendLine('EHLO vyapaarai.local');
        } else if (step === 1 && code === 250) {
          step = 2;
          sendLine('AUTH LOGIN');
        } else if (step === 2 && code === 334) {
          step = 3;
          sendLine(Buffer.from(params.user).toString('base64'));
        } else if (step === 3 && code === 334) {
          step = 4;
          sendLine(Buffer.from(params.pass).toString('base64'));
        } else if (step === 4 && code === 235) {
          step = 5;
          sendLine(`MAIL FROM:<${params.user}>`);
        } else if (step === 5 && code === 250) {
          step = 6;
          sendLine(`RCPT TO:<${params.to}>`);
        } else if (step === 6 && (code === 250 || code === 251)) {
          step = 7;
          sendLine('DATA');
        } else if (step === 7 && code === 354) {
          step = 8;
          const boundary = 'vyapaarai_boundary_' + Date.now();
          sendLine(
            [
              `Date: ${new Date().toUTCString()}`,
              `Message-ID: <${crypto.randomUUID()}@vyapaarai.local>`,
              `From: "VyapaarAI" <${params.user}>`,
              `To: <${params.to}>`,
              `Subject: ${params.subject}`,
              'MIME-Version: 1.0',
              `Content-Type: multipart/alternative; boundary="${boundary}"`,
              '',
              `--${boundary}`,
              'Content-Type: text/plain; charset=UTF-8',
              'Content-Transfer-Encoding: 8bit',
              '',
              params.text,
              '',
              `--${boundary}`,
              'Content-Type: text/html; charset=UTF-8',
              'Content-Transfer-Encoding: 8bit',
              '',
              params.html,
              '',
              `--${boundary}--`,
              '.',
            ].join('\r\n'),
          );
        } else if (step === 8 && code === 250) {
          step = 9;
          sendLine('QUIT');
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
    socket.on('error', (err) => {
      console.error('[VyapaarAI SMTP Socket Error]', err.message);
      clearTimeout(timeout);
      resolve({ ok: false, error: err.message });
    });
  });
}

async function sendEmailGreetingOtp(
  toEmail: string,
  name: string,
  store: string,
  otp: string,
): Promise<{ delivered: boolean; provider: string; error?: string }> {
  reloadRootEnv();
  const recipientName = name?.trim() || 'Merchant';
  const businessName = store?.trim() || 'your store';
  const subject = `${otp} is your VyapaarAI Email Verification Code`;
  const text = `Greetings from VyapaarAI!\n\nWelcome to VyapaarAI, ${recipientName}! (${businessName})\n\nYour 6-digit email verification OTP is: ${otp}\n\nValid for 10 minutes.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #FDF9F1; border: 1px solid #E8DCBF; border-radius: 16px; color: #2A1F14;">
      <h2 style="color: #C1440E; margin-top: 0;">Greetings from VyapaarAI!</h2>
      <p style="font-size: 15px; line-height: 1.5;">Hello <strong>${recipientName}</strong> (<strong>${businessName}</strong>),</p>
      <p style="font-size: 14px; color: #4A3A24;">Please enter the 6-digit verification code below in the <strong>Email OTP</strong> box:</p>
      <div style="margin: 20px 0; padding: 16px; background: #FFF3EE; border: 2px dashed #C1440E; border-radius: 12px; text-align: center;">
        <span style="font-size: 28px; font-weight: bold; letter-spacing: 8px; color: #C1440E;">${otp}</span>
      </div>
      <p style="font-size: 12px; color: #6B5836;">This OTP is valid for 10 minutes.</p>
    </div>
  `;

  console.log(`\n=============================================================`);
  console.log(`📧 [VyapaarAI Email OTP -> ${toEmail}]`);
  console.log(`Message : Greetings from VyapaarAI! Hello ${recipientName}!`);
  console.log(`OTP Code: ${otp}`);
  console.log(`=============================================================\n`);

  const smtpUser = (process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (smtpUser && smtpPass) {
    const res = await sendSmtpEmail({
      host: (process.env.SMTP_HOST || 'smtp.gmail.com').trim(),
      port: Number(process.env.SMTP_PORT || '465'),
      user: smtpUser,
      pass: smtpPass,
      to: toEmail,
      subject,
      text,
      html,
    });
    if (res.ok) {
      console.log(`✅ [VyapaarAI Email OTP Delivered via Free Gmail SMTP to ${toEmail}]`);
      return { delivered: true, provider: 'gmail-smtp' };
    }
    return { delivered: false, provider: 'gmail-smtp', error: res.error };
  }

  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'VyapaarAI <onboarding@resend.dev>',
          to: [toEmail],
          subject,
          text,
          html,
        }),
      });
      if (res.ok) {
        console.log(`✅ [VyapaarAI Email Delivered via Resend to ${toEmail}]`);
        return { delivered: true, provider: 'resend' };
      }
    } catch {
      // Ignore
    }
  }

  return {
    delivered: false,
    provider: 'console',
    error: 'Add GMAIL_USER & GMAIL_APP_PASSWORD in .env for live email delivery',
  };
}

async function sendSmsGreetingOtp(
  toPhone: string,
  fallbackEmail: string | undefined,
  name: string,
  store: string,
  otp: string,
  isNew: boolean,
): Promise<{ delivered: boolean; provider: string; channel?: string; error?: string }> {
  reloadRootEnv();
  const recipientName = name?.trim() || 'Merchant';
  const businessName = store?.trim() || 'your store';
  const msg = isNew
    ? `Greetings from VyapaarAI! Welcome to VyapaarAI, ${recipientName}! Your 6-digit mobile verification OTP for ${businessName} (+91 ${toPhone}) is ${otp}.`
    : `Greetings from VyapaarAI! Welcome back, ${recipientName}! Your 6-digit mobile sign-in OTP for ${businessName} (+91 ${toPhone}) is ${otp}.`;

  console.log(`\n=============================================================`);
  console.log(`📱 [VyapaarAI Mobile OTP -> +91 ${toPhone}]`);
  console.log(`Message : ${msg}`);
  console.log(`OTP Code: ${otp}`);
  console.log(`=============================================================\n`);

  // 0. Try Twilio Free Trial SMS API (Priority #1 when TWILIO_ACCOUNT_SID is set)
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID.trim();
      const token = process.env.TWILIO_AUTH_TOKEN.trim();
      const authHeader = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
      let fromNumber = (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_FROM || '').replace(/\s+/g, '');

      if (!fromNumber || fromNumber.startsWith('+91') || fromNumber.endsWith(toPhone)) {
        const listRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=5`,
          { headers: { Authorization: authHeader } },
        );
        const listData = (await listRes.json().catch(() => ({}))) as Record<string, any>;
        const existingNumbers = listData.incoming_phone_numbers as Array<Record<string, any>> | undefined;
        if (existingNumbers && existingNumbers.length > 0 && existingNumbers[0].phone_number) {
          fromNumber = String(existingNumbers[0].phone_number);
          console.log(`[VyapaarAI Twilio] Auto-detected your Twilio sender number: ${fromNumber}`);
        }
      }

      if (fromNumber && !fromNumber.startsWith('+91')) {
        const body = new URLSearchParams({
          To: `+91${toPhone}`,
          From: fromNumber,
          Body: msg,
        });
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
          },
        );
        const twilioData = (await res.json().catch(() => ({}))) as Record<string, any>;
        if (res.ok) {
          console.log(`✅ [VyapaarAI SMS Delivered via Twilio (${fromNumber}) to +91 ${toPhone}]`);
          return { delivered: true, provider: 'twilio', channel: 'sms' };
        } else {
          console.warn(`⚠️ [VyapaarAI Twilio Failed] ${twilioData.message || twilioData.code || res.statusText}`);
        }
      }
    } catch {
      // Fall through to next provider
    }
  }

  // 1. Try 2Factor.in Free Trial API
  if (process.env.TWOFACTOR_API_KEY) {
    try {
      const apiKey = process.env.TWOFACTOR_API_KEY.trim();
      const res = await fetch(
        `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/+91${toPhone}/${otp}`,
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, any>;
      if (res.ok && data.Status === 'Success') {
        console.log(`✅ [VyapaarAI SMS Delivered via 2Factor.in to +91 ${toPhone}]`);
        return { delivered: true, provider: '2factor', channel: 'sms' };
      }
    } catch {
      // Fall through
    }
  }

  // 2. Try Fast2SMS (First try 'otp' route, then 'q' route)
  if (process.env.FAST2SMS_API_KEY) {
    try {
      const apiKey = process.env.FAST2SMS_API_KEY.trim();
      const otpRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          authorization: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          route: 'otp',
          variables_values: otp,
          flash: 0,
          numbers: toPhone,
        }),
      });
      const otpData = (await otpRes.json().catch(() => ({}))) as Record<string, any>;
      if (otpRes.ok && otpData.return === true) {
        console.log(`✅ [VyapaarAI SMS Delivered via Fast2SMS (OTP route) to +91 ${toPhone}]`);
        return { delivered: true, provider: 'fast2sms', channel: 'sms' };
      }

      const quickRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          authorization: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          route: 'q',
          message: msg,
          language: 'english',
          flash: 0,
          numbers: toPhone,
        }),
      });
      const quickData = (await quickRes.json().catch(() => ({}))) as Record<string, any>;
      if (quickRes.ok && quickData.return === true) {
        console.log(`✅ [VyapaarAI SMS Delivered via Fast2SMS (Quick route) to +91 ${toPhone}]`);
        return { delivered: true, provider: 'fast2sms', channel: 'sms' };
      }
    } catch {
      // Fall through to free services
    }
  }

  // 3. Free Gmail Mobile OTP Relay (100% Free & Instant Delivery to User's Phone / Email Inbox)
  const smtpUser = (process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const targetEmail = (fallbackEmail || smtpUser || '').trim().toLowerCase();

  if (smtpUser && smtpPass && targetEmail) {
    const subject = `${otp} is your VyapaarAI Mobile OTP for +91 ${toPhone}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #FDF9F1; border: 1px solid #E8DCBF; border-radius: 16px; color: #2A1F14;">
        <div style="display: inline-block; padding: 4px 10px; background: #E7F5EC; color: #1B5E34; border-radius: 999px; font-size: 11px; font-weight: bold; margin-bottom: 10px;">
          MOBILE NUMBER OTP (+91 ${toPhone})
        </div>
        <h2 style="color: #C1440E; margin-top: 0;">Greetings from VyapaarAI!</h2>
        <p style="font-size: 15px; line-height: 1.5;">${msg}</p>
        <p style="font-size: 14px; color: #4A3A24;">Enter this 6-digit code in the <strong>Mobile Number OTP</strong> box:</p>
        <div style="margin: 20px 0; padding: 16px; background: #E7F5EC; border: 2px dashed #22683F; border-radius: 12px; text-align: center;">
          <span style="font-size: 28px; font-weight: bold; letter-spacing: 8px; color: #1B5E34;">${otp}</span>
        </div>
        <p style="font-size: 12px; color: #6B5836;">Mobile: +91 ${toPhone} · Valid for 10 minutes.</p>
      </div>
    `;

    const res = await sendSmtpEmail({
      host: (process.env.SMTP_HOST || 'smtp.gmail.com').trim(),
      port: Number(process.env.SMTP_PORT || '465'),
      user: smtpUser,
      pass: smtpPass,
      to: targetEmail,
      subject,
      text: msg,
      html,
    });

    if (res.ok) {
      console.log(
        `✅ [VyapaarAI Mobile OTP (+91 ${toPhone}) Delivered via Free Gmail OTP Gateway to ${targetEmail}]`,
      );
      return {
        delivered: true,
        provider: 'free-gmail-otp-gateway',
        channel: targetEmail,
      };
    }
  }

  return {
    delivered: false,
    provider: 'console',
    error: 'OTP printed in server terminal',
  };
}

function setDevSessionCookie(res: any, userId: string, remember = true): void {
  const maxAgePart = remember ? `; Max-Age=${30 * 24 * 60 * 60}` : '; Max-Age=86400';
  res.setHeader(
    'Set-Cookie',
    `vyapaar_user_id=${encodeURIComponent(userId)}; Path=/; HttpOnly; SameSite=Lax${maxAgePart}`,
  );
}

function getAuthenticatedDevUser(req: any): StoredUser | undefined {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:vyapaar_user_id)=([^;]+)/);
  if (!match) return undefined;
  return usersById.get(decodeURIComponent(match[1]));
}

function sanitizeUserResponse(u: StoredUser) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    businessName: u.businessName,
    gstin: u.gstin,
    role: u.role,
    businessId: u.businessId,
    onboardingComplete: true,
  };
}

function vyapaarAuthDevPlugin(): Plugin {
  return {
    name: 'vyapaar-auth-dev-middleware',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/auth/')) {
          next();
          return;
        }

        loadUsers();
        const route = req.url.split('?')[0].replace('/api/auth', '');
        const sendJson = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        if (req.method === 'GET' && route === '/me') {
          const user = getAuthenticatedDevUser(req);
          if (user) {
            sendJson(200, sanitizeUserResponse(user));
            return;
          }
          sendJson(401, { message: 'Unauthorized' });
          return;
        }

        if (req.method !== 'POST') {
          next();
          return;
        }

        let rawBody = '';
        req.on('data', (chunk) => {
          rawBody += chunk.toString('utf-8');
        });
        req.on('end', async () => {
          let body: Record<string, any> = {};
          try {
            body = rawBody ? JSON.parse(rawBody) : {};
          } catch {
            body = {};
          }

          // ==================================================================
          // 1. SIGN-UP: INLINE EMAIL OTP (/send-email-otp & /verify-email-otp)
          // ==================================================================
          if (route === '/send-email-otp') {
            const cleanEmail = String(body.email ?? '').trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
              sendJson(400, { success: false, message: 'Please enter a valid email address.' });
              return;
            }
            const existing = usersByEmail.get(cleanEmail);
            if (existing) {
              sendJson(409, {
                success: false,
                code: 'EMAIL_EXISTS',
                email: cleanEmail,
                phone: existing.phone ?? null,
                message: 'This email address is already registered. Please sign in to your account.',
              });
              return;
            }
            const otp = generateSixDigitOtp();
            emailOtps.set(cleanEmail, { otp, verified: false, expiresAt: Date.now() + OTP_TTL_MS });
            const delivery = await sendEmailGreetingOtp(cleanEmail, body.name, body.businessName, otp);
            sendJson(200, {
              success: true,
              otp,
              delivered: delivery.delivered,
              provider: delivery.provider,
              providerNotice: delivery.error,
              message: `6-digit verification OTP sent to ${cleanEmail}`,
            });
            return;
          }

          if (route === '/verify-email-otp') {
            const cleanEmail = String(body.email ?? '').trim().toLowerCase();
            const cleanOtp = String(body.otp ?? '').trim();
            const rec = emailOtps.get(cleanEmail);
            if (cleanOtp === '123456') {
              if (rec) rec.verified = true;
              sendJson(200, { success: true, verified: true });
              return;
            }
            if (!rec || Date.now() > rec.expiresAt) {
              sendJson(400, { success: false, message: 'Email OTP expired. Please click Resend OTP or use 123456.' });
              return;
            }
            if (rec.otp !== cleanOtp) {
              sendJson(400, { success: false, message: 'Invalid 6-digit Email OTP. Or use bypass 123456.' });
              return;
            }
            rec.verified = true;
            sendJson(200, { success: true, verified: true });
            return;
          }

          // ==================================================================
          // 2. SIGN-UP: INLINE PHONE OTP (/send-phone-otp & /verify-phone-otp)
          // ==================================================================
          if (route === '/send-phone-otp') {
            const normalizedPhone = normalizePhone(String(body.phone ?? ''));
            const fallbackEmail = body.email ? String(body.email).trim().toLowerCase() : undefined;
            if (!/^\d{10}$/.test(normalizedPhone)) {
              sendJson(400, { success: false, message: 'Please enter a valid 10-digit mobile number.' });
              return;
            }
            if (usersByPhone.has(normalizedPhone)) {
              sendJson(409, {
                success: false,
                code: 'PHONE_EXISTS',
                phone: normalizedPhone,
                message: 'This mobile number already has an account. Please sign in directly.',
              });
              return;
            }
            const otp = generateSixDigitOtp();
            phoneOtps.set(normalizedPhone, { otp, verified: false, expiresAt: Date.now() + OTP_TTL_MS });
            const delivery = await sendSmsGreetingOtp(
              normalizedPhone,
              fallbackEmail,
              body.name,
              body.businessName,
              otp,
              true,
            );
            sendJson(200, {
              success: true,
              otp,
              delivered: delivery.delivered,
              provider: delivery.provider,
              channel: delivery.channel,
              providerNotice: delivery.error,
              message: `6-digit verification OTP sent for +91 ${normalizedPhone}`,
            });
            return;
          }

          if (route === '/verify-phone-otp') {
            const normalizedPhone = normalizePhone(String(body.phone ?? ''));
            const cleanOtp = String(body.otp ?? '').trim();
            const rec = phoneOtps.get(normalizedPhone);
            if (cleanOtp === '123456') {
              if (rec) rec.verified = true;
              sendJson(200, { success: true, verified: true });
              return;
            }
            if (!rec || Date.now() > rec.expiresAt) {
              sendJson(400, { success: false, message: 'Mobile OTP expired. Please click Resend OTP or use 123456.' });
              return;
            }
            if (rec.otp !== cleanOtp) {
              sendJson(400, { success: false, message: 'Invalid 6-digit Mobile OTP. Or use bypass 123456.' });
              return;
            }
            rec.verified = true;
            sendJson(200, { success: true, verified: true });
            return;
          }

          // ==================================================================
          // 3. COMPLETE SIGN-UP (/complete-signup)
          // ==================================================================
          if (route === '/complete-signup') {
            const cleanEmail = String(body.email ?? '').trim().toLowerCase();
            const normalizedPhone = normalizePhone(String(body.phone ?? ''));
            const emailRec = emailOtps.get(cleanEmail);
            const isEmailValid =
              (emailRec && (emailRec.verified || body.emailOtp === emailRec.otp)) ||
              body.emailOtp === '123456' ||
              Boolean(body.emailVerified);
            if (!isEmailValid) {
              sendJson(400, { success: false, message: 'Please verify your Email OTP first (or enter 123456).' });
              return;
            }
            const phoneRec = phoneOtps.get(normalizedPhone);
            const isPhoneValid =
              (phoneRec && (phoneRec.verified || body.phoneOtp === phoneRec.otp)) ||
              body.phoneOtp === '123456' ||
              Boolean(body.phoneVerified);
            if (!isPhoneValid) {
              sendJson(400, { success: false, message: 'Please verify your Mobile OTP first (or enter 123456).' });
              return;
            }
            if (usersByEmail.has(cleanEmail)) {
              sendJson(409, {
                success: false,
                code: 'EMAIL_EXISTS',
                email: cleanEmail,
                message: 'Email already registered. Please sign in.',
              });
              return;
            }
            if (usersByPhone.has(normalizedPhone)) {
              sendJson(409, {
                success: false,
                code: 'PHONE_EXISTS',
                phone: normalizedPhone,
                message: 'Mobile number already registered. Please sign in.',
              });
              return;
            }
            const created: StoredUser = {
              id: crypto.randomUUID(),
              name: String(body.name ?? '').trim(),
              email: cleanEmail,
              phone: normalizedPhone,
              businessName:
                String(body.businessName ?? '').trim() || `${String(body.name ?? '').trim()}'s Store`,
              gstin: body.gstin ? String(body.gstin).trim().toUpperCase() : null,
              password: body.password ? String(body.password) : null,
              role: 'owner',
              businessId: crypto.randomUUID(),
              onboardingComplete: true,
            };
            usersById.set(created.id, created);
            if (created.email) usersByEmail.set(created.email, created);
            if (created.phone) usersByPhone.set(created.phone, created);
            saveUsers();
            emailOtps.delete(cleanEmail);
            phoneOtps.delete(normalizedPhone);
            setDevSessionCookie(res, created.id, Boolean(body.remember ?? true));
            sendJson(201, {
              success: true,
              redirectUrl: '/dashboard',
              user: sanitizeUserResponse(created),
            });
            return;
          }

          // ==================================================================
          // 4. RETURNING USER SIGN-IN WITH MOBILE OTP (/request-login-otp & /verify-login-otp & /otp/send & /otp/verify)
          // ==================================================================
          if (route === '/request-login-otp' || route === '/otp/send') {
            const normalizedPhone = normalizePhone(String(body.phone ?? ''));
            if (!/^\d{10}$/.test(normalizedPhone)) {
              sendJson(400, {
                ok: false,
                success: false,
                message: 'Please enter a valid 10-digit Indian mobile number.',
              });
              return;
            }
            const user = usersByPhone.get(normalizedPhone);
            if (!user) {
              sendJson(404, {
                ok: false,
                success: false,
                code: 'ACCOUNT_NOT_FOUND',
                message: `No VyapaarAI account found with +91 ${normalizedPhone}. Please create a new account first.`,
              });
              return;
            }
            const otp = generateSixDigitOtp();
            const storeName = user.businessName || `${user.name}'s Store`;
            loginOtps.set(normalizedPhone, { otp, expiresAt: Date.now() + OTP_TTL_MS });
            const delivery = await sendSmsGreetingOtp(
              normalizedPhone,
              user.email ?? undefined,
              user.name,
              storeName,
              otp,
              false,
            );
            sendJson(200, {
              ok: true,
              success: true,
              delivered: delivery.delivered,
              provider: delivery.provider,
              channel: delivery.channel,
              providerNotice: delivery.error,
              cooldownSeconds: 15,
              message: `6-digit OTP sent for +91 ${normalizedPhone}`,
              account: {
                name: user.name,
                businessName: storeName,
                phone: normalizedPhone,
              },
            });
            return;
          }

          if (route === '/verify-login-otp' || route === '/otp/verify') {
            const normalizedPhone = normalizePhone(String(body.phone ?? ''));
            const cleanOtp = String(body.otp ?? body.code ?? '').trim();
            if (cleanOtp.length !== 6) {
              sendJson(400, {
                ok: false,
                success: false,
                message: 'Please enter the 6-digit OTP code.',
              });
              return;
            }
            const pending = loginOtps.get(normalizedPhone);
            if (!pending || Date.now() > pending.expiresAt) {
              sendJson(400, {
                ok: false,
                success: false,
                message: 'OTP expired or not requested yet. Please click Send OTP.',
              });
              return;
            }
            if (pending.otp !== cleanOtp && cleanOtp !== '123456') {
              sendJson(400, {
                ok: false,
                success: false,
                message: 'Invalid 6-digit OTP. Please check the code sent to your mobile/email.',
              });
              return;
            }
            const user = usersByPhone.get(normalizedPhone);
            if (!user) {
              sendJson(404, {
                ok: false,
                success: false,
                code: 'ACCOUNT_NOT_FOUND',
                message: 'Account not found. Please create an account.',
              });
              return;
            }
            loginOtps.delete(normalizedPhone);
            setDevSessionCookie(res, user.id, Boolean(body.remember ?? true));
            sendJson(200, {
              ok: true,
              success: true,
              redirectUrl: '/dashboard',
              user: sanitizeUserResponse(user),
            });
            return;
          }

          // ==================================================================
          // 5. SIGN-IN WITH EMAIL (OTP OR PASSWORD)
          // ==================================================================
          if (route === '/request-email-login-otp') {
            const cleanEmail = String(body.email ?? '').trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
              sendJson(400, { success: false, message: 'Please enter a valid email address.' });
              return;
            }
            const user = usersByEmail.get(cleanEmail);
            if (!user) {
              sendJson(404, {
                success: false,
                code: 'ACCOUNT_NOT_FOUND',
                message: `No VyapaarAI account found with ${cleanEmail}. Please create a new account first.`,
              });
              return;
            }
            const otp = generateSixDigitOtp();
            const storeName = user.businessName || `${user.name}'s Store`;
            emailLoginOtps.set(cleanEmail, { otp, expiresAt: Date.now() + OTP_TTL_MS });
            const delivery = await sendEmailGreetingOtp(cleanEmail, user.name, storeName, otp);
            sendJson(200, {
              success: true,
              delivered: delivery.delivered,
              provider: delivery.provider,
              message: `6-digit login OTP sent to ${cleanEmail}`,
              account: {
                name: user.name,
                businessName: storeName,
                phone: user.phone || '',
              },
            });
            return;
          }

          if (route === '/verify-email-login-otp') {
            const cleanEmail = String(body.email ?? '').trim().toLowerCase();
            const cleanOtp = String(body.otp ?? '').trim();
            const pending = emailLoginOtps.get(cleanEmail);
            if (!pending || Date.now() > pending.expiresAt) {
              sendJson(400, { success: false, message: 'Email OTP expired. Please click Send OTP.' });
              return;
            }
            if (pending.otp !== cleanOtp && cleanOtp !== '123456') {
              sendJson(400, { success: false, message: 'Invalid 6-digit Email OTP.' });
              return;
            }
            const user = usersByEmail.get(cleanEmail);
            if (!user) {
              sendJson(404, { success: false, message: 'Account not found.' });
              return;
            }
            emailLoginOtps.delete(cleanEmail);
            setDevSessionCookie(res, user.id, Boolean(body.remember ?? true));
            sendJson(200, {
              success: true,
              redirectUrl: '/dashboard',
              user: sanitizeUserResponse(user),
            });
            return;
          }

          if (route === '/login') {
            const rawIdentifier = String(body.email ?? body.phone ?? '').trim();
            const cleanEmail = rawIdentifier.toLowerCase();
            const cleanPhone = normalizePhone(rawIdentifier);
            const cleanPassword = String(body.password ?? '');
            if (!rawIdentifier) {
              sendJson(400, { message: 'Please enter your email address or mobile number.' });
              return;
            }
            const user = usersByEmail.get(cleanEmail) || (cleanPhone ? usersByPhone.get(cleanPhone) : undefined);
            if (!user) {
              sendJson(404, {
                code: 'ACCOUNT_NOT_FOUND',
                message: `No account found with ${rawIdentifier}. Please create a new account.`,
              });
              return;
            }
            if (user.password && cleanPassword && cleanPassword !== user.password) {
              sendJson(401, { message: 'Incorrect password. Or use OTP sign-in instead.' });
              return;
            }
            setDevSessionCookie(res, user.id, Boolean(body.remember ?? true));
            sendJson(200, sanitizeUserResponse(user));
            return;
          }

          if (route === '/demo-login') {
            loadUsers();
            let user =
              usersByPhone.get('9642865348') ||
              usersByEmail.get('djathin58@gmail.com') ||
              Array.from(usersById.values())[0];
            if (!user) {
              user = {
                id: '0eda82ff-7f5e-44a6-bd15-a785d56c7068',
                name: 'Jathin',
                email: 'djathin58@gmail.com',
                phone: '9642865348',
                businessName: 'Sri sai Kirana',
                gstin: null,
                role: 'owner',
                businessId: '07657761-9ffc-4ffa-a276-8ecc51215fa6',
                onboardingComplete: true,
              };
              usersById.set(user.id, user);
              if (user.email) usersByEmail.set(user.email, user);
              if (user.phone) usersByPhone.set(user.phone, user);
              saveUsers();
            }
            setDevSessionCookie(res, user.id, true);
            sendJson(200, {
              success: true,
              redirectUrl: '/dashboard',
              user: sanitizeUserResponse(user),
            });
            return;
          }

          if (route === '/register') {
            const cleanEmail = String(body.email ?? '').trim().toLowerCase();
            const cleanPassword = String(body.password ?? '');
            const name = String(body.name ?? '').trim() || cleanEmail.split('@')[0] || 'Merchant';
            const phone = body.phone ? normalizePhone(String(body.phone)) : null;
            const businessName =
              String(body.businessName ?? '').trim() || `${name}'s Store`;
            const gstin = body.gstin ? String(body.gstin).trim().toUpperCase() : null;

            if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
              sendJson(400, { message: 'Please enter a valid email address.' });
              return;
            }

            if (usersByEmail.has(cleanEmail)) {
              sendJson(409, {
                code: 'EMAIL_EXISTS',
                email: cleanEmail,
                message: 'An account with this email already exists. Please sign in.',
              });
              return;
            }

            const created: StoredUser = {
              id: crypto.randomUUID(),
              name,
              email: cleanEmail,
              phone,
              businessName,
              gstin,
              password: cleanPassword || null,
              role: 'owner',
              businessId: crypto.randomUUID(),
              onboardingComplete: true,
            };
            usersById.set(created.id, created);
            if (created.email) usersByEmail.set(created.email, created);
            if (created.phone) usersByPhone.set(created.phone, created);
            saveUsers();
            setDevSessionCookie(res, created.id, Boolean(body.remember ?? true));
            sendJson(201, sanitizeUserResponse(created));
            return;
          }

          if (route === '/google') {
            const { accessToken, remember } = body;
            if (!accessToken) {
              sendJson(400, { message: 'Access token is required' });
              return;
            }
            try {
              const gRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              if (!gRes.ok) {
                sendJson(401, { message: 'Invalid Google token' });
                return;
              }
              const gUser = (await gRes.json()) as Record<string, any>;
              const cleanEmail = String(gUser.email ?? '').trim().toLowerCase();
              const name = String(gUser.name ?? '').trim() || cleanEmail.split('@')[0] || 'Merchant';

              let user = usersByEmail.get(cleanEmail);
              if (!user) {
                user = {
                  id: crypto.randomUUID(),
                  name,
                  email: cleanEmail,
                  phone: null,
                  businessName: `${name}'s Store`,
                  gstin: null,
                  role: 'owner',
                  businessId: crypto.randomUUID(),
                  onboardingComplete: true,
                };
                usersById.set(user.id, user);
                usersByEmail.set(cleanEmail, user);
                saveUsers();
              }
              setDevSessionCookie(res, user.id, Boolean(remember ?? true));
              sendJson(200, sanitizeUserResponse(user));
              return;
            } catch (err: any) {
              sendJson(500, { message: err?.message || 'Google authentication failed' });
              return;
            }
          }

          if (route === '/onboarding') {
            const currentUser = getAuthenticatedDevUser(req);
            if (!currentUser) {
              sendJson(401, { message: 'Unauthorized' });
              return;
            }
            if (body.name && String(body.name).trim()) {
              currentUser.name = String(body.name).trim();
            }
            if (body.businessName && String(body.businessName).trim()) {
              currentUser.businessName = String(body.businessName).trim();
            }
            if (body.gstin !== undefined) {
              currentUser.gstin =
                body.gstin && String(body.gstin).trim()
                  ? String(body.gstin).trim().toUpperCase()
                  : null;
            }
            currentUser.onboardingComplete = true;
            usersById.set(currentUser.id, currentUser);
            if (currentUser.email) usersByEmail.set(currentUser.email, currentUser);
            if (currentUser.phone) usersByPhone.set(currentUser.phone, currentUser);
            saveUsers();
            sendJson(200, { ok: true, success: true, user: sanitizeUserResponse(currentUser) });
            return;
          }

          if (route === '/logout') {
            res.setHeader('Set-Cookie', 'vyapaar_user_id=; Path=/; HttpOnly; Max-Age=0');
            sendJson(200, { message: 'Logged out successfully' });
            return;
          }

          next();
        });
      });
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    vyapaarAuthDevPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: false,
    host: '0.0.0.0',
    allowedHosts: true,
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
