import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface MemoryUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  businessName: string | null;
  gstin: string | null;
  passwordHash: string | null;
  provider: string;
  googleId: string | null;
  profileImage: string | null;
  role: string;
  businessId: string | null;
  onboardingComplete: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FieldOtpRecord {
  target: string;
  otp: string;
  verified: boolean;
  expiresAt: number;
}

export interface PendingSignupSession {
  name: string;
  businessName: string;
  gstin: string | null;
  email: string;
  phone: string;
  passwordHash: string | null;
  emailOtp: string;
  phoneOtp: string;
  emailGreeting: string;
  smsGreeting: string;
  expiresAt: number;
}

export interface PendingLoginSession {
  phone: string;
  userId: string;
  otp: string;
  smsGreeting: string;
  expiresAt: number;
}

export function normalizePhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return digits.slice(1);
  }
  return digits;
}

export function generateSixDigitOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

function findWorkspaceRoot(): string {
  const startDirs = [process.cwd(), import.meta.dirname];
  for (const base of startDirs) {
    if (!base) continue;
    let current = base;
    for (let i = 0; i < 6; i++) {
      if (
        fs.existsSync(path.resolve(current, "pnpm-workspace.yaml")) ||
        fs.existsSync(path.resolve(current, ".env"))
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

const usersById = new Map<string, MemoryUser>();
const usersByEmail = new Map<string, MemoryUser>();
const usersByPhone = new Map<string, MemoryUser>();
const emailOtps = new Map<string, FieldOtpRecord>();
const phoneOtps = new Map<string, FieldOtpRecord>();
const pendingSignups = new Map<string, PendingSignupSession>();
const pendingLogins = new Map<string, PendingLoginSession>();

const DATA_FILE = path.resolve(findWorkspaceRoot(), ".vyapaar-users.json");

function loadPersistedUsers(): void {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Array<Record<string, any>>;
      for (const item of parsed) {
        const cleanEmail =
          item.email && String(item.email).trim()
            ? String(item.email).trim().toLowerCase()
            : null;
        const user: MemoryUser = {
          id: item.id,
          name: item.name,
          email: cleanEmail,
          phone: item.phone ? normalizePhone(String(item.phone)) : null,
          businessName: item.businessName ?? null,
          gstin: item.gstin ?? null,
          passwordHash: item.passwordHash ?? null,
          provider: item.provider ?? "local",
          googleId: item.googleId ?? null,
          profileImage: item.profileImage ?? null,
          role: item.role ?? "owner",
          businessId: item.businessId ?? null,
          onboardingComplete:
            typeof item.onboardingComplete === "boolean"
              ? item.onboardingComplete
              : Boolean(item.businessName && !String(item.name || "").startsWith("Shop ")),
          isActive: item.isActive ?? true,
          createdAt: new Date(item.createdAt || Date.now()),
          updatedAt: new Date(item.updatedAt || Date.now()),
        };
        usersById.set(user.id, user);
        if (user.email) {
          usersByEmail.set(user.email, user);
        }
        if (user.phone) {
          usersByPhone.set(user.phone, user);
        }
      }
    }
  } catch {
    // Ignore file read errors in restricted environments
  }
}

function persistUsers(): void {
  try {
    const list = Array.from(usersById.values());
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch {
    // Ignore file write errors in restricted environments
  }
}

loadPersistedUsers();

export const memoryAuthStore = {
  findByEmail(email: string): MemoryUser | undefined {
    if (!email || !email.trim()) return undefined;
    loadPersistedUsers();
    return usersByEmail.get(email.trim().toLowerCase());
  },

  findByPhone(phone: string): MemoryUser | undefined {
    if (!phone || !phone.trim()) return undefined;
    loadPersistedUsers();
    const normalized = normalizePhone(phone);
    return usersByPhone.get(normalized);
  },

  findById(id: string): MemoryUser | undefined {
    loadPersistedUsers();
    return usersById.get(id);
  },

  createUser(params: {
    name: string;
    email?: string | null;
    phone?: string | null;
    businessName?: string | null;
    gstin?: string | null;
    passwordHash?: string | null;
    provider?: string;
    googleId?: string | null;
    profileImage?: string | null;
    onboardingComplete?: boolean;
  }): MemoryUser {
    const now = new Date();
    const userId = crypto.randomUUID();
    const businessId = crypto.randomUUID();
    const normalizedPhone = params.phone ? normalizePhone(params.phone) : null;
    const cleanEmail =
      params.email && params.email.trim() ? params.email.trim().toLowerCase() : null;
    const user: MemoryUser = {
      id: userId,
      name: params.name.trim(),
      email: cleanEmail,
      phone: normalizedPhone,
      businessName: params.businessName?.trim() || `${params.name.trim()}'s Store`,
      gstin: params.gstin?.trim() || null,
      passwordHash: params.passwordHash ?? null,
      provider: params.provider ?? "local",
      googleId: params.googleId ?? null,
      profileImage: params.profileImage ?? null,
      role: "owner",
      businessId,
      onboardingComplete: params.onboardingComplete ?? Boolean(params.businessName?.trim()),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    usersById.set(user.id, user);
    if (user.email) {
      usersByEmail.set(user.email, user);
    }
    if (user.phone) {
      usersByPhone.set(user.phone, user);
    }
    persistUsers();
    return user;
  },

  updateUser(
    id: string,
    patch: Partial<
      Pick<
        MemoryUser,
        | "name"
        | "email"
        | "phone"
        | "businessName"
        | "gstin"
        | "googleId"
        | "profileImage"
        | "onboardingComplete"
      >
    >,
  ): MemoryUser | undefined {
    loadPersistedUsers();
    const existing = usersById.get(id);
    if (!existing) return undefined;

    if (patch.email !== undefined) {
      if (existing.email) usersByEmail.delete(existing.email);
      existing.email = patch.email ? patch.email.trim().toLowerCase() : null;
      if (existing.email) usersByEmail.set(existing.email, existing);
    }
    if (patch.phone !== undefined) {
      if (existing.phone) usersByPhone.delete(existing.phone);
      existing.phone = patch.phone ? normalizePhone(patch.phone) : null;
      if (existing.phone) usersByPhone.set(existing.phone, existing);
    }
    if (patch.name !== undefined && patch.name.trim()) {
      existing.name = patch.name.trim();
    }
    if (patch.businessName !== undefined) {
      existing.businessName = patch.businessName ? patch.businessName.trim() : existing.businessName;
    }
    if (patch.gstin !== undefined) {
      existing.gstin = patch.gstin ? patch.gstin.trim().toUpperCase() : null;
    }
    if (patch.googleId !== undefined) {
      existing.googleId = patch.googleId;
    }
    if (patch.profileImage !== undefined) {
      existing.profileImage = patch.profileImage;
    }
    if (patch.onboardingComplete !== undefined) {
      existing.onboardingComplete = patch.onboardingComplete;
    }
    existing.updatedAt = new Date();
    usersById.set(existing.id, existing);
    persistUsers();
    return existing;
  },

  saveEmailOtp(email: string, otp: string, ttlMs: number): void {
    const key = email.trim().toLowerCase();
    emailOtps.set(key, {
      target: key,
      otp,
      verified: false,
      expiresAt: Date.now() + ttlMs,
    });
  },

  getEmailOtp(email: string): FieldOtpRecord | undefined {
    return emailOtps.get(email.trim().toLowerCase());
  },

  markEmailOtpVerified(email: string): void {
    const rec = emailOtps.get(email.trim().toLowerCase());
    if (rec) rec.verified = true;
  },

  deleteEmailOtp(email: string): void {
    emailOtps.delete(email.trim().toLowerCase());
  },

  savePhoneOtp(phone: string, otp: string, ttlMs: number): void {
    const key = normalizePhone(phone);
    phoneOtps.set(key, {
      target: key,
      otp,
      verified: false,
      expiresAt: Date.now() + ttlMs,
    });
  },

  getPhoneOtp(phone: string): FieldOtpRecord | undefined {
    return phoneOtps.get(normalizePhone(phone));
  },

  markPhoneOtpVerified(phone: string): void {
    const rec = phoneOtps.get(normalizePhone(phone));
    if (rec) rec.verified = true;
  },

  deletePhoneOtp(phone: string): void {
    phoneOtps.delete(normalizePhone(phone));
  },

  savePendingSignup(session: PendingSignupSession): void {
    const emailKey = session.email.trim().toLowerCase();
    const phoneKey = normalizePhone(session.phone);
    pendingSignups.set(`email:${emailKey}`, session);
    pendingSignups.set(`phone:${phoneKey}`, session);
  },

  getPendingSignup(email: string, phone: string): PendingSignupSession | undefined {
    const emailKey = email.trim().toLowerCase();
    const phoneKey = normalizePhone(phone);
    return pendingSignups.get(`email:${emailKey}`) || pendingSignups.get(`phone:${phoneKey}`);
  },

  deletePendingSignup(email: string, phone: string): void {
    const emailKey = email.trim().toLowerCase();
    const phoneKey = normalizePhone(phone);
    pendingSignups.delete(`email:${emailKey}`);
    pendingSignups.delete(`phone:${phoneKey}`);
  },

  savePendingLoginOtp(session: PendingLoginSession): void {
    const phoneKey = normalizePhone(session.phone);
    pendingLogins.set(phoneKey, session);
  },

  getPendingLoginOtp(phone: string): PendingLoginSession | undefined {
    const phoneKey = normalizePhone(phone);
    return pendingLogins.get(phoneKey);
  },

  deletePendingLoginOtp(phone: string): void {
    const phoneKey = normalizePhone(phone);
    pendingLogins.delete(phoneKey);
  },
};
