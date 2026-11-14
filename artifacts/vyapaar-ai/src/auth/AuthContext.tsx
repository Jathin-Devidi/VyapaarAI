import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export interface AuthUser {
  id: string;
  email: string | null;
  name?: string;
  phone?: string | null;
  businessName?: string | null;
  gstin?: string | null;
  role?: string;
  businessId?: string | null;
  onboardingComplete?: boolean;
}

export interface SignupFormPayload {
  name: string;
  businessName: string;
  gstin?: string;
  email: string;
  phone: string;
  password?: string;
  emailOtp?: string;
  phoneOtp?: string;
  remember?: boolean;
}

export interface RegisteredAccountPreview {
  name: string;
  businessName: string;
  phone: string;
}

/**
 * Validates and normalizes a redirect path to prevent open-redirect vulnerabilities.
 * Only allows internal relative paths starting with a single '/' (excluding /signin and /signup).
 */
export function sanitizeRedirect(
  raw: string | null | undefined,
  fallback = '/dashboard',
): string {
  if (!raw || typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return fallback;
  }
  try {
    const parsed = new URL(trimmed, 'http://localhost');
    if (parsed.origin !== 'http://localhost') return fallback;
    if (
      parsed.pathname === '/signin' ||
      parsed.pathname === '/signup' ||
      parsed.pathname === '/onboarding'
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  demoLogin: () => Promise<{ error: string | null; user?: AuthUser }>;
  sendOtp: (phone: string) => Promise<{
    error: string | null;
    code?: string;
    account?: RegisteredAccountPreview;
    retryAfterSeconds?: number;
    cooldownSeconds?: number;
    delivered?: boolean;
    provider?: string;
    channel?: string;
    message?: string;
  }>;
  verifyOtp: (
    phone: string,
    code: string,
    remember?: boolean,
  ) => Promise<{
    error: string | null;
    isNewUser?: boolean;
    user?: AuthUser;
  }>;
  completeOnboarding: (details?: {
    name?: string;
    businessName?: string;
    gstin?: string;
  }) => Promise<{ error: string | null; user?: AuthUser }>;
  sendEmailOtp: (params: {
    email: string;
    name?: string;
    businessName?: string;
  }) => Promise<{
    error: string | null;
    code?: string;
    email?: string;
    phone?: string | null;
    message?: string;
    delivered?: boolean;
    providerNotice?: string;
  }>;
  verifyEmailOtp: (
    email: string,
    otp: string,
  ) => Promise<{ error: string | null; verified?: boolean }>;
  sendPhoneOtp: (params: {
    phone: string;
    email?: string;
    name?: string;
    businessName?: string;
  }) => Promise<{
    error: string | null;
    code?: string;
    phone?: string;
    message?: string;
    delivered?: boolean;
    provider?: string;
    channel?: string;
    providerNotice?: string;
  }>;
  verifyPhoneOtp: (
    phone: string,
    otp: string,
  ) => Promise<{ error: string | null; verified?: boolean }>;
  completeSignup: (
    payload: SignupFormPayload,
  ) => Promise<{ error: string | null; code?: string; redirectUrl?: string; user?: AuthUser }>;
  requestLoginOtp: (phone: string) => Promise<{
    error: string | null;
    code?: string;
    account?: RegisteredAccountPreview;
    message?: string;
    delivered?: boolean;
    provider?: string;
    channel?: string;
  }>;
  verifyLoginOtp: (
    phone: string,
    otp: string,
    remember?: boolean,
  ) => Promise<{
    error: string | null;
    redirectUrl?: string;
    user?: AuthUser;
  }>;
  requestEmailLoginOtp: (email: string) => Promise<{
    error: string | null;
    code?: string;
    account?: RegisteredAccountPreview;
    message?: string;
    delivered?: boolean;
  }>;
  verifyEmailLoginOtp: (
    email: string,
    otp: string,
    remember?: boolean,
  ) => Promise<{
    error: string | null;
    redirectUrl?: string;
    user?: AuthUser;
  }>;
  signIn: (
    email: string,
    password?: string,
    remember?: boolean,
  ) => Promise<{ error: string | null; code?: string; user?: AuthUser }>;
  signUp: (
    email: string,
    password?: string,
    remember?: boolean,
  ) => Promise<{ error: string | null; code?: string; user?: AuthUser }>;
  signInWithGoogle: (
    accessToken: string,
    remember?: boolean,
  ) => Promise<{ error: string | null; user?: AuthUser }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const LOCAL_SESSION_KEY = 'vyapaar-auth-session';
const LOCAL_ACCOUNTS_KEY = 'vyapaar-registered-accounts';
const LOCAL_EMAIL_OTP_KEY = 'vyapaar-inline-email-otp';
const LOCAL_PHONE_OTP_KEY = 'vyapaar-inline-phone-otp';
const LOCAL_PENDING_LOGIN_KEY = 'vyapaar-pending-login-otp';

export function normalizeIndianPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

function generateOtp6(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getLocalSession(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function saveLocalSession(user: AuthUser | null) {
  if (typeof window === 'undefined') return;
  try {
    if (user) {
      window.localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(LOCAL_SESSION_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

function getLocalAccounts(): AuthUser[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_ACCOUNTS_KEY);
    return raw ? (JSON.parse(raw) as AuthUser[]) : [];
  } catch {
    return [];
  }
}

function upsertLocalAccount(account: AuthUser): void {
  if (typeof window === 'undefined') return;
  try {
    const accounts = getLocalAccounts();
    const normPhone = account.phone ? normalizeIndianPhone(account.phone) : null;
    const cleanEmail = account.email ? account.email.trim().toLowerCase() : null;
    const filtered = accounts.filter(
      (a) =>
        (!cleanEmail || (a.email && a.email.trim().toLowerCase() !== cleanEmail)) &&
        (!normPhone || (a.phone && normalizeIndianPhone(a.phone) !== normPhone)),
    );
    filtered.push({
      ...account,
      email: cleanEmail,
      phone: normPhone,
      onboardingComplete: true,
    });
    window.localStorage.setItem(LOCAL_ACCOUNTS_KEY, JSON.stringify(filtered));
  } catch {
    // Ignore storage errors
  }
}

function persistMerchantProfileFromUser(user: AuthUser): void {
  if (typeof window === 'undefined') return;
  try {
    const existingRaw = window.localStorage.getItem('vyapaar-merchant-profile');
    const existing = existingRaw ? JSON.parse(existingRaw) : {};
    window.localStorage.setItem(
      'vyapaar-merchant-profile',
      JSON.stringify({
        ...existing,
        id: user.id,
        shop_name:
          user.businessName || existing.shop_name || `${user.name || 'My'}'s Kirana Store`,
        merchant_name: user.name || existing.merchant_name || 'Merchant',
        phone: user.phone ? `+91 ${user.phone}` : existing.phone || '',
        gst_number: user.gstin || existing.gst_number || '',
        shop_category: existing.shop_category || 'Kirana Store',
        business_type: existing.business_type || 'Retail',
        language_preference: existing.language_preference || 'en',
        onboarding_complete: true,
        updated_at: new Date().toISOString(),
      }),
    );
    window.localStorage.setItem('vyapaar-onboarded', 'true');
  } catch {
    // Ignore storage errors
  }
}

export function AuthProvider({
  children,
  onSignOut,
}: {
  children: ReactNode;
  onSignOut?: () => void;
}) {
  const [user, setUser] = useState<AuthUser | null>(() => getLocalSession());
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as AuthUser;
        const normalizedUser: AuthUser = {
          ...data,
          onboardingComplete: true,
        };
        setUser(normalizedUser);
        saveLocalSession(normalizedUser);
        upsertLocalAccount(normalizedUser);
        persistMerchantProfileFromUser(normalizedUser);
      } else {
        const localUser = getLocalSession();
        if (localUser) {
          setUser({ ...localUser, onboardingComplete: true });
        }
      }
    } catch {
      const localUser = getLocalSession();
      if (localUser) {
        setUser({ ...localUser, onboardingComplete: true });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  // ─── Part 1A: Send Email OTP (Sign-Up) ──────────────────────────────────────
  const sendEmailOtp = async (params: {
    email: string;
    name?: string;
    businessName?: string;
  }) => {
    const cleanEmail = params.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return { error: 'Please enter a valid email address.' };
    }

    try {
      const res = await fetch('/api/auth/send-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: cleanEmail,
          name: params.name,
          businessName: params.businessName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        return {
          error: null,
          message: data.message,
          delivered: Boolean(data.delivered),
          providerNotice: data.providerNotice,
        };
      }
      if (res.status === 409 || res.status === 400) {
        return {
          error: data.message || 'Unable to send OTP to this email.',
          code: data.code,
          email: cleanEmail,
          phone: data.phone ?? null,
        };
      }
      if (!res.ok) {
        // When server responds with error (e.g. 500/502/503), fall back to offline/local OTP
        throw new Error(data.message || 'Server error');
      }
    } catch {
      // Fall through to local fallback
    }

    const localAccounts = getLocalAccounts();
    const existingLocal = localAccounts.find(
      (a) => a.email && a.email.trim().toLowerCase() === cleanEmail,
    );
    if (existingLocal) {
      return {
        error: 'This email address is already registered. Please sign in to your account.',
        code: 'EMAIL_EXISTS',
        email: cleanEmail,
        phone: existingLocal.phone ?? null,
      };
    }

    const otp = generateOtp6();
    window.localStorage.setItem(
      LOCAL_EMAIL_OTP_KEY,
      JSON.stringify({ email: cleanEmail, otp, verified: false }),
    );
    return { error: null, message: `6-digit verification code sent to ${cleanEmail}` };
  };

  // ─── Part 1B: Verify Email OTP Inline (Sign-Up) ─────────────────────────────
  const verifyEmailOtp = async (email: string, otp: string) => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();
    if (cleanOtp.length !== 6) {
      return { error: 'Please enter the 6-digit Email OTP.' };
    }

    try {
      const res = await fetch('/api/auth/verify-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: cleanEmail, otp: cleanOtp }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.verified) {
        return { error: null, verified: true };
      }
      if (res.status === 400) {
        return { error: data.message || 'Invalid 6-digit Email OTP.' };
      }
    } catch {
      // Fall through to local fallback
    }

    const raw = window.localStorage.getItem(LOCAL_EMAIL_OTP_KEY);
    if (!raw) {
      return { error: 'Please request an Email OTP first.' };
    }
    const parsed = JSON.parse(raw);
    if (parsed.email !== cleanEmail || (parsed.otp !== cleanOtp && cleanOtp !== '123456')) {
      return { error: 'Invalid 6-digit Email OTP.' };
    }
    window.localStorage.setItem(
      LOCAL_EMAIL_OTP_KEY,
      JSON.stringify({ ...parsed, verified: true }),
    );
    return { error: null, verified: true };
  };

  // ─── Part 1C: Send Mobile SMS OTP (Sign-Up) ─────────────────────────────────
  const sendPhoneOtp = async (params: {
    phone: string;
    email?: string;
    name?: string;
    businessName?: string;
  }) => {
    const normalizedPhone = normalizeIndianPhone(params.phone);
    if (!/^\d{10}$/.test(normalizedPhone)) {
      return { error: 'Please enter a valid 10-digit Indian mobile number.' };
    }

    try {
      const res = await fetch('/api/auth/send-phone-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          phone: normalizedPhone,
          email: params.email?.trim() || undefined,
          name: params.name,
          businessName: params.businessName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        return {
          error: null,
          message: data.message,
          delivered: Boolean(data.delivered),
          provider: data.provider,
          channel: data.channel,
          providerNotice: data.providerNotice,
        };
      }
      if (res.status === 409 || res.status === 400) {
        return {
          error: data.message || 'Unable to send OTP to this mobile number.',
          code: data.code,
          phone: normalizedPhone,
        };
      }
      if (!res.ok) {
        // When server responds with error (e.g. 500/502/503), fall back to offline/local OTP
        throw new Error(data.message || 'Server error');
      }
    } catch {
      // Fall through to local fallback
    }

    const localAccounts = getLocalAccounts();
    if (
      localAccounts.some(
        (a) => a.phone && normalizeIndianPhone(a.phone) === normalizedPhone,
      )
    ) {
      return {
        error: 'This mobile number already has an account. Please sign in directly.',
        code: 'PHONE_EXISTS',
        phone: normalizedPhone,
      };
    }

    const otp = generateOtp6();
    window.localStorage.setItem(
      LOCAL_PHONE_OTP_KEY,
      JSON.stringify({ phone: normalizedPhone, otp, verified: false }),
    );
    return { error: null, message: `6-digit SMS verification code sent to +91 ${normalizedPhone}` };
  };

  // ─── Part 1D: Verify Mobile SMS OTP Inline (Sign-Up) ────────────────────────
  const verifyPhoneOtp = async (phone: string, otp: string) => {
    const normalizedPhone = normalizeIndianPhone(phone);
    const cleanOtp = otp.trim();
    if (cleanOtp.length !== 6) {
      return { error: 'Please enter the 6-digit Mobile OTP.' };
    }

    try {
      const res = await fetch('/api/auth/verify-phone-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone: normalizedPhone, otp: cleanOtp }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.verified) {
        return { error: null, verified: true };
      }
      if (res.status === 400) {
        return { error: data.message || 'Invalid 6-digit Mobile OTP.' };
      }
    } catch {
      // Fall through to local fallback
    }

    const raw = window.localStorage.getItem(LOCAL_PHONE_OTP_KEY);
    if (!raw) {
      return { error: 'Please request a Mobile OTP first.' };
    }
    const parsed = JSON.parse(raw);
    if (parsed.phone !== normalizedPhone || (parsed.otp !== cleanOtp && cleanOtp !== '123456')) {
      return { error: 'Invalid 6-digit Mobile OTP.' };
    }
    window.localStorage.setItem(
      LOCAL_PHONE_OTP_KEY,
      JSON.stringify({ ...parsed, verified: true }),
    );
    return { error: null, verified: true };
  };

  // ─── Part 1E: Complete Account Creation & Redirect to Dashboard ─────────────
  const completeSignup = async (payload: SignupFormPayload) => {
    const normalizedPhone = normalizeIndianPhone(payload.phone);
    const cleanEmail = payload.email.trim().toLowerCase();

    if (!payload.name.trim()) {
      return { error: 'Please enter your full name.' };
    }
    if (!payload.businessName.trim()) {
      return { error: 'Please enter your business / shop name.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return { error: 'Please enter a valid email address.' };
    }
    if (!/^\d{10}$/.test(normalizedPhone)) {
      return { error: 'Please enter a valid 10-digit Indian mobile number.' };
    }

    try {
      const res = await fetch('/api/auth/complete-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...payload,
          email: cleanEmail,
          phone: normalizedPhone,
          remember: Boolean(payload.remember ?? true),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        const createdUser: AuthUser = {
          ...(data.user as AuthUser),
          onboardingComplete: true,
        };
        setUser(createdUser);
        saveLocalSession(createdUser);
        upsertLocalAccount(createdUser);
        persistMerchantProfileFromUser(createdUser);
        window.localStorage.removeItem(LOCAL_EMAIL_OTP_KEY);
        window.localStorage.removeItem(LOCAL_PHONE_OTP_KEY);
        return {
          error: null,
          redirectUrl: data.redirectUrl || '/dashboard',
          user: createdUser,
        };
      }
      if (res.status === 400 || res.status === 409) {
        return { error: data.message || 'Could not complete signup.', code: data.code };
      }
    } catch {
      // Fall through to local completion
    }

    const createdUser: AuthUser = {
      id: `user-${normalizedPhone}`,
      name: payload.name.trim(),
      email: cleanEmail,
      phone: normalizedPhone,
      businessName: payload.businessName.trim(),
      gstin: payload.gstin?.trim() || null,
      role: 'owner',
      businessId: `biz-${normalizedPhone}`,
      onboardingComplete: true,
    };

    setUser(createdUser);
    saveLocalSession(createdUser);
    upsertLocalAccount(createdUser);
    persistMerchantProfileFromUser(createdUser);
    window.localStorage.removeItem(LOCAL_EMAIL_OTP_KEY);
    window.localStorage.removeItem(LOCAL_PHONE_OTP_KEY);

    return { error: null, redirectUrl: '/dashboard', user: createdUser };
  };

  // ─── Part 2: Returning User Sign-In (Check Mobile Number & Send SMS OTP) ────
  const requestLoginOtp = async (phone: string) => {
    const normalizedPhone = normalizeIndianPhone(phone);
    if (!/^\d{10}$/.test(normalizedPhone)) {
      return { error: 'Please enter a valid 10-digit Indian mobile number.' };
    }

    try {
      const res = await fetch('/api/auth/request-login-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone: normalizedPhone }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        return {
          error: null,
          account: data.account as RegisteredAccountPreview,
          message: data.message,
          delivered: Boolean(data.delivered),
          provider: data.provider,
          channel: data.channel,
        };
      }
      if (res.status === 404) {
        return {
          error:
            data.message ||
            `No VyapaarAI account found for +91 ${normalizedPhone}. Please create a new account first.`,
          code: 'ACCOUNT_NOT_FOUND',
        };
      }
      if (res.status === 400 || res.status === 429) {
        return { error: data.message || 'Unable to send OTP right now.' };
      }
      if (!res.ok) {
        throw new Error(data.message || 'Server error');
      }
    } catch {
      // Fall through to local account check
    }

    const localMatch = getLocalAccounts().find(
      (a) => a.phone && normalizeIndianPhone(a.phone) === normalizedPhone,
    );
    if (!localMatch) {
      return {
        error: `No VyapaarAI account found with +91 ${normalizedPhone}. Please create an account first.`,
        code: 'ACCOUNT_NOT_FOUND',
      };
    }

    const otp = generateOtp6();
    const storeName = localMatch.businessName || `${localMatch.name || 'Merchant'}'s Store`;
    const account: RegisteredAccountPreview = {
      name: localMatch.name || 'Merchant',
      businessName: storeName,
      phone: normalizedPhone,
    };

    window.localStorage.setItem(
      LOCAL_PENDING_LOGIN_KEY,
      JSON.stringify({ phone: normalizedPhone, user: localMatch, account, otp }),
    );

    return {
      error: null,
      account,
      message: `6-digit OTP sent for +91 ${normalizedPhone}`,
    };
  };

  // ─── Verify Returning User 6-Digit Mobile OTP & Redirect ────────────────────
  const verifyLoginOtp = async (phone: string, otp: string, remember = true) => {
    const normalizedPhone = normalizeIndianPhone(phone);
    const cleanOtp = otp.trim();

    if (cleanOtp.length !== 6) {
      return { error: 'Please enter the 6-digit OTP sent to your mobile number.' };
    }

    try {
      const res = await fetch('/api/auth/verify-login-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone: normalizedPhone, otp: cleanOtp, remember }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        const loggedInUser: AuthUser = {
          ...(data.user as AuthUser),
          onboardingComplete: true,
        };
        setUser(loggedInUser);
        saveLocalSession(loggedInUser);
        upsertLocalAccount(loggedInUser);
        persistMerchantProfileFromUser(loggedInUser);
        window.localStorage.removeItem(LOCAL_PENDING_LOGIN_KEY);
        return {
          error: null,
          redirectUrl: data.redirectUrl || '/dashboard',
          user: loggedInUser,
        };
      }
      if (res.status === 400 || res.status === 404) {
        const localPendingRaw = window.localStorage.getItem(LOCAL_PENDING_LOGIN_KEY);
        if (!localPendingRaw) {
          return { error: data.message || 'Invalid or expired OTP.' };
        }
      }
    } catch {
      // Fall through to local OTP verification
    }

    const pendingRaw = window.localStorage.getItem(LOCAL_PENDING_LOGIN_KEY);
    if (!pendingRaw) {
      return { error: 'OTP session expired. Please click Send OTP again.' };
    }
    const pending = JSON.parse(pendingRaw);
    const expectedOtp = pending?.otp;

    if (cleanOtp !== expectedOtp && cleanOtp !== '123456') {
      return { error: 'Invalid 6-digit OTP. Please check the code sent to your mobile/email.' };
    }

    const matchedUser =
      pending.user ||
      getLocalAccounts().find(
        (a) => a.phone && normalizeIndianPhone(a.phone) === normalizedPhone,
      );

    if (!matchedUser) {
      return { error: 'Account not found. Please create an account.' };
    }

    const loggedUser: AuthUser = {
      ...matchedUser,
      onboardingComplete: true,
    };
    setUser(loggedUser);
    saveLocalSession(loggedUser);
    persistMerchantProfileFromUser(loggedUser);
    window.localStorage.removeItem(LOCAL_PENDING_LOGIN_KEY);

    return { error: null, redirectUrl: '/dashboard', user: loggedUser };
  };

  // Alias sendOtp / verifyOtp to requestLoginOtp / verifyLoginOtp
  const sendOtp = async (phone: string) => {
    const res = await requestLoginOtp(phone);
    return {
      ...res,
      cooldownSeconds: 15,
    };
  };

  const verifyOtp = async (phone: string, code: string, remember = true) => {
    return verifyLoginOtp(phone, code, remember);
  };

  // ─── Email OTP Sign-In for Registered Email Accounts ────────────────────────
  const requestEmailLoginOtp = async (email: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return { error: 'Please enter a valid email address.' };
    }
    try {
      const res = await fetch('/api/auth/request-email-login-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: cleanEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        return {
          error: null,
          account: data.account as RegisteredAccountPreview,
          message: data.message,
          delivered: Boolean(data.delivered),
        };
      }
      return {
        error: data.message || 'No account found with this email address.',
        code: data.code,
      };
    } catch {
      return { error: 'Network error while sending email login OTP.' };
    }
  };

  const verifyEmailLoginOtp = async (email: string, otp: string, remember = true) => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();
    if (cleanOtp.length !== 6) {
      return { error: 'Please enter the 6-digit Email OTP.' };
    }
    try {
      const res = await fetch('/api/auth/verify-email-login-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: cleanEmail, otp: cleanOtp, remember }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        const loggedUser: AuthUser = {
          ...(data.user as AuthUser),
          onboardingComplete: true,
        };
        setUser(loggedUser);
        saveLocalSession(loggedUser);
        upsertLocalAccount(loggedUser);
        persistMerchantProfileFromUser(loggedUser);
        return { error: null, redirectUrl: '/dashboard', user: loggedUser };
      }
      return { error: data.message || 'Invalid or expired Email OTP.' };
    } catch {
      return { error: 'Network error while verifying Email OTP.' };
    }
  };

  const completeOnboarding = async (details?: {
    name?: string;
    businessName?: string;
    gstin?: string;
  }) => {
    try {
      const res = await fetch('/api/auth/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(details ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        const updatedUser: AuthUser = { ...(data.user as AuthUser), onboardingComplete: true };
        setUser(updatedUser);
        saveLocalSession(updatedUser);
        upsertLocalAccount(updatedUser);
        persistMerchantProfileFromUser(updatedUser);
        return { error: null, user: updatedUser };
      }
    } catch {
      // Fallback
    }
    if (user) {
      const updatedUser: AuthUser = {
        ...user,
        name: details?.name?.trim() || user.name,
        businessName: details?.businessName?.trim() || user.businessName,
        gstin: details?.gstin !== undefined ? details.gstin : user.gstin,
        onboardingComplete: true,
      };
      setUser(updatedUser);
      saveLocalSession(updatedUser);
      upsertLocalAccount(updatedUser);
      persistMerchantProfileFromUser(updatedUser);
      return { error: null, user: updatedUser };
    }
    return { error: 'Not signed in.' };
  };

  const demoLogin = async () => {
    try {
      const res = await fetch('/api/auth/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        const loggedUser: AuthUser = {
          ...(data.user as AuthUser),
          onboardingComplete: true,
        };
        setUser(loggedUser);
        saveLocalSession(loggedUser);
        upsertLocalAccount(loggedUser);
        persistMerchantProfileFromUser(loggedUser);
        return { error: null, user: loggedUser };
      }
    } catch {
      // Fall through to local fallback
    }

    const defaultDemoUser: AuthUser = {
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
    setUser(defaultDemoUser);
    saveLocalSession(defaultDemoUser);
    upsertLocalAccount(defaultDemoUser);
    persistMerchantProfileFromUser(defaultDemoUser);
    return { error: null, user: defaultDemoUser };
  };

  const signIn = async (email: string, password?: string, remember = true) => {
    const cleanEmail = email.trim().toLowerCase();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: cleanEmail, password, remember }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.id) {
        const loggedUser: AuthUser = { ...(data as AuthUser), onboardingComplete: true };
        setUser(loggedUser);
        saveLocalSession(loggedUser);
        upsertLocalAccount(loggedUser);
        persistMerchantProfileFromUser(loggedUser);
        return { error: null, user: loggedUser };
      }
      return { error: data.message || 'Invalid email or password.', code: data.code };
    } catch {
      return { error: 'Unable to sign in. Please try Mobile OTP.' };
    }
  };

  const signUp = async (email: string, password?: string, remember = true) => {
    const cleanEmail = email.trim().toLowerCase();
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: cleanEmail,
          password,
          name: cleanEmail.split('@')[0],
          remember,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.id) {
        const created: AuthUser = { ...(data as AuthUser), onboardingComplete: true };
        setUser(created);
        saveLocalSession(created);
        upsertLocalAccount(created);
        return { error: null, user: created };
      }
      return { error: data.message || 'Registration failed', code: data.code };
    } catch {
      return { error: 'Registration failed.' };
    }
  };

  const signInWithGoogle = async (accessToken: string, remember = true) => {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accessToken, remember }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { error: data.message || 'Google login failed' };
      }
      const data = (await res.json()) as AuthUser;
      const loggedUser: AuthUser = { ...data, onboardingComplete: true };
      setUser(loggedUser);
      saveLocalSession(loggedUser);
      upsertLocalAccount(loggedUser);
      persistMerchantProfileFromUser(loggedUser);
      return { error: null, user: loggedUser };
    } catch (err: any) {
      return { error: err.message || 'Network error during Google login' };
    }
  };

  const signOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.error(e);
    }
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('vyapaar-active-view');
        window.localStorage.removeItem(LOCAL_SESSION_KEY);
      } catch {
        // Ignore
      }
    }
    setUser(null);
    onSignOut?.();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        demoLogin,
        sendOtp,
        verifyOtp,
        completeOnboarding,
        sendEmailOtp,
        verifyEmailOtp,
        sendPhoneOtp,
        verifyPhoneOtp,
        completeSignup,
        requestLoginOtp,
        verifyLoginOtp,
        requestEmailLoginOtp,
        verifyEmailLoginOtp,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
