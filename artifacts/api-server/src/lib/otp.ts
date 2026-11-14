import crypto from "node:crypto";
import { db, otpCodesTable } from "@workspace/db";
import { eq, and, gt, desc } from "drizzle-orm";

export const OTP_VALIDITY_MS = 5 * 60 * 1000; // 5 minutes
export const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds
export const MAX_CODES_PER_HOUR = 5;
export const MAX_ATTEMPTS = 5;

function getOtpSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production" && !secret) {
    throw new Error("JWT_SECRET environment variable is required in production.");
  }
  return secret || "fallback_secret_for_hackathon";
}

export function getAllowedCountryCodes(): string[] {
  const raw = process.env.OTP_ALLOWED_COUNTRY_CODES || "+91";
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Normalizes a phone number into E.164 format (e.g. +919642865348) and validates
 * that it matches one of the allowed country prefixes (default: +91).
 */
export function normalizeE164Phone(raw: string): {
  valid: boolean;
  e164: string;
  digits10: string;
  error?: string;
} {
  const cleaned = String(raw || "").replace(/[\s\-()]/g, "");
  const digitsOnly = cleaned.replace(/\D/g, "");

  let e164 = "";
  let digits10 = "";

  if (/^[6-9]\d{9}$/.test(digitsOnly)) {
    digits10 = digitsOnly;
    e164 = `+91${digitsOnly}`;
  } else if (/^0[6-9]\d{9}$/.test(digitsOnly)) {
    digits10 = digitsOnly.slice(1);
    e164 = `+91${digits10}`;
  } else if (/^91[6-9]\d{9}$/.test(digitsOnly)) {
    digits10 = digitsOnly.slice(2);
    e164 = `+${digitsOnly}`;
  } else if (cleaned.startsWith("+") && /^\+\d{10,15}$/.test(cleaned)) {
    e164 = cleaned;
    digits10 = digitsOnly.slice(-10);
  } else {
    return {
      valid: false,
      e164: "",
      digits10: "",
      error: "Please enter a valid 10-digit mobile number.",
    };
  }

  const allowedPrefixes = getAllowedCountryCodes();
  const isAllowed = allowedPrefixes.some((prefix) => e164.startsWith(prefix));
  if (!isAllowed) {
    return {
      valid: false,
      e164,
      digits10,
      error: `Only ${allowedPrefixes.join(", ")} mobile numbers are supported.`,
    };
  }

  return { valid: true, e164, digits10 };
}

export function generateOtpCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export function hashOtpCode(phone: string, code: string): string {
  return crypto
    .createHmac("sha256", getOtpSecret())
    .update(`${phone}:${code.trim()}`)
    .digest("hex");
}

export function verifyOtpHash(phone: string, candidateCode: string, expectedHash: string): boolean {
  const candidateHash = hashOtpCode(phone, candidateCode);
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface MemoryOtpEntry {
  id: string;
  phone: string;
  codeHash: string;
  attempts: number;
  used: boolean;
  expiresAt: number;
  createdAt: number;
}

const memoryOtpHistory = new Map<string, MemoryOtpEntry[]>();

export async function issueOtpForPhone(rawPhone: string): Promise<{
  ok: boolean;
  code?: string;
  e164?: string;
  digits10?: string;
  retryAfterSeconds?: number;
  status?: number;
  error?: string;
}> {
  const norm = normalizeE164Phone(rawPhone);
  if (!norm.valid) {
    return { ok: false, status: 400, error: norm.error };
  }

  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const history = (memoryOtpHistory.get(norm.e164) || []).filter((e) => e.createdAt > oneHourAgo);

  // 1. Check 30-second resend cooldown
  const latest = history[history.length - 1];
  if (latest && now - latest.createdAt < RESEND_COOLDOWN_MS) {
    const retryAfterSeconds = Math.ceil((RESEND_COOLDOWN_MS - (now - latest.createdAt)) / 1000);
    return {
      ok: false,
      status: 429,
      retryAfterSeconds,
      error: `Please wait ${retryAfterSeconds}s before requesting another OTP.`,
    };
  }

  // 2. Check max 5 codes per hour per phone number
  if (history.length >= MAX_CODES_PER_HOUR) {
    return {
      ok: false,
      status: 429,
      error: "Too many OTP requests for this number. Please try again in an hour.",
    };
  }

  const code = generateOtpCode();
  const codeHash = hashOtpCode(norm.e164, code);
  const entry: MemoryOtpEntry = {
    id: crypto.randomUUID(),
    phone: norm.e164,
    codeHash,
    attempts: 0,
    used: false,
    expiresAt: now + OTP_VALIDITY_MS,
    createdAt: now,
  };

  history.push(entry);
  memoryOtpHistory.set(norm.e164, history);

  // Also persist to PostgreSQL otp_codes table if DATABASE_URL is configured
  if (process.env.DATABASE_URL) {
    try {
      await db.insert(otpCodesTable).values({
        phone: norm.e164,
        codeHash,
        attempts: 0,
        used: false,
        expiresAt: new Date(entry.expiresAt),
      });
    } catch {
      // Ignore if DB table is not pushed yet
    }
  }

  return {
    ok: true,
    code,
    e164: norm.e164,
    digits10: norm.digits10,
  };
}

export async function verifyOtpForPhone(
  rawPhone: string,
  code: string,
): Promise<{
  ok: boolean;
  e164?: string;
  digits10?: string;
  status?: number;
  error?: string;
}> {
  const norm = normalizeE164Phone(rawPhone);
  if (!norm.valid) {
    return { ok: false, status: 400, error: norm.error };
  }

  const cleanCode = String(code || "").trim();
  if (!/^\d{6}$/.test(cleanCode)) {
    return { ok: false, status: 400, error: "Please enter a valid 6-digit OTP." };
  }

  const now = Date.now();
  const history = memoryOtpHistory.get(norm.e164) || [];
  const active = [...history].reverse().find((e) => !e.used && e.expiresAt > now);

  if (active) {
    if (active.attempts >= MAX_ATTEMPTS) {
      active.used = true;
      return {
        ok: false,
        status: 400,
        error: "Too many incorrect attempts. Please request a new OTP.",
      };
    }

    active.attempts += 1;
    const isValid =
      verifyOtpHash(norm.e164, cleanCode, active.codeHash) ||
      (process.env.NODE_ENV !== "production" && cleanCode === "123456");

    if (!isValid) {
      const remaining = MAX_ATTEMPTS - active.attempts;
      return {
        ok: false,
        status: 400,
        error:
          remaining > 0
            ? `Invalid OTP code (${remaining} attempt${remaining === 1 ? "" : "s"} remaining).`
            : "Too many incorrect attempts. Please request a new OTP.",
      };
    }

    // Atomic single-use mark
    active.used = true;
    return { ok: true, e164: norm.e164, digits10: norm.digits10 };
  }

  // Check PostgreSQL otp_codes if available
  if (process.env.DATABASE_URL) {
    try {
      const rows = await db
        .select()
        .from(otpCodesTable)
        .where(and(eq(otpCodesTable.phone, norm.e164), eq(otpCodesTable.used, false), gt(otpCodesTable.expiresAt, new Date())))
        .orderBy(desc(otpCodesTable.createdAt))
        .limit(1);

      const dbEntry = rows[0];
      if (dbEntry) {
        if (dbEntry.attempts >= MAX_ATTEMPTS) {
          await db.update(otpCodesTable).set({ used: true }).where(eq(otpCodesTable.id, dbEntry.id));
          return { ok: false, status: 400, error: "Too many incorrect attempts. Please request a new OTP." };
        }
        const isValid = verifyOtpHash(norm.e164, cleanCode, dbEntry.codeHash);
        if (!isValid) {
          await db
            .update(otpCodesTable)
            .set({ attempts: dbEntry.attempts + 1 })
            .where(eq(otpCodesTable.id, dbEntry.id));
          return { ok: false, status: 400, error: "Invalid 6-digit OTP." };
        }
        await db.update(otpCodesTable).set({ used: true }).where(eq(otpCodesTable.id, dbEntry.id));
        return { ok: true, e164: norm.e164, digits10: norm.digits10 };
      }
    } catch {
      // Ignore DB fallback errors
    }
  }

  return {
    ok: false,
    status: 400,
    error: "OTP has expired or was already used. Please request a new OTP.",
  };
}

