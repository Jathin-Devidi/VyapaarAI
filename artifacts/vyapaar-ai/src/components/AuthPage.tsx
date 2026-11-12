import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Store,
  Mail,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Smartphone,
  RefreshCw,
  Mic,
  BarChart3,
  Users,
  TrendingUp,
  User,
  FileText,
  Info,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useGoogleLogin } from '@react-oauth/google';
import {
  useAuth,
  type RegisteredAccountPreview,
} from '../auth/AuthContext';

// Simple phone normalizer (fallback if the exported helper is unavailable)
const normalizePhone = (rawPhone: string): string => {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
};
import heroShopkeeper from '@/assets/hero-shopkeeper.jpg';

interface AuthPageProps {
  mode: 'signin' | 'signup';
  onBack: () => void;
  onToggleMode: () => void;
  signedOut?: boolean;
}

const floatingStats = [
  { icon: BarChart3, label: 'Daily Revenue', value: '₹24,530', color: '#F5A623', delay: 0.2 },
  { icon: Users, label: 'Customers', value: '1,124', color: '#22683F', delay: 0.5 },
  { icon: TrendingUp, label: 'Growth', value: '+18%', color: '#C1440E', delay: 0.8 },
  { icon: Mic, label: 'Voice Entries', value: '340 today', color: '#5A3778', delay: 1.1 },
];

// ─── Compact 6-Digit Individual Box OTP Input (Popped up below Email/Phone) ──
function SixDigitOtpInput({
  value,
  onChange,
  disabled,
  autoFocus = false,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '');

  useEffect(() => {
    if (autoFocus && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [autoFocus]);

  const handleDigitChange = (index: number, raw: string) => {
    const clean = raw.replace(/\D/g, '');
    if (!clean) {
      const next = [...digits];
      next[index] = '';
      onChange(next.join(''));
      return;
    }
    const next = [...digits];
    for (let i = 0; i < clean.length && index + i < 6; i++) {
      next[index + i] = clean[i];
    }
    onChange(next.join(''));
    const focusIndex = Math.min(index + clean.length, 5);
    inputRefs.current[focusIndex]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        const next = [...digits];
        next[index] = '';
        onChange(next.join(''));
      } else if (index > 0) {
        const next = [...digits];
        next[index - 1] = '';
        onChange(next.join(''));
        inputRefs.current[index - 1]?.focus();
      }
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted) {
      onChange(pasted);
      const focusIndex = Math.min(pasted.length, 6) - 1;
      if (focusIndex >= 0) {
        inputRefs.current[focusIndex]?.focus();
      }
    }
  };

  return (
    <div className="grid grid-cols-6 gap-1.5 flex-1">
      {digits.map((digit, idx) => (
        <input
          key={idx}
          ref={(el) => {
            inputRefs.current[idx] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={6}
          disabled={disabled}
          value={digit}
          onChange={(e) => handleDigitChange(idx, e.target.value)}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          onPaste={handlePaste}
          className="w-full h-10 text-center font-serif text-base font-bold rounded-lg border border-ink-200 bg-white text-ink focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20 transition-all disabled:opacity-60"
        />
      ))}
    </div>
  );
}

export function AuthPage({ mode, onBack, onToggleMode, signedOut }: AuthPageProps) {
  const {
    sendEmailOtp,
    verifyEmailOtp,
    sendPhoneOtp,
    verifyPhoneOtp,
    completeSignup,
    requestLoginOtp,
    verifyLoginOtp,
    requestEmailLoginOtp,
    verifyEmailLoginOtp,
    signInWithGoogle,
    demoLogin,
  } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(() => {
    if (signedOut) return 'You have been signed out successfully.';
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('signedout') === '1') {
        return 'You have been signed out successfully.';
      }
    }
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(true);

  const handleQuickDemoLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await demoLogin();
      if (res.error) {
        setError(res.error);
      }
    } catch (e: any) {
      setError(e?.message || 'Demo login failed');
    } finally {
      setLoading(false);
    }
  };

  // ─── Part 1: New User Sign-Up State ─────────────────────────────────────────
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [gstin, setGstin] = useState('');
  const [email, setEmail] = useState('');
  const [signupPhone, setSignupPhone] = useState('');

  // Inline Email OTP State (Sign-Up)
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtpLoading, setEmailOtpLoading] = useState(false);
  const [emailOtp, setEmailOtp] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailOtpError, setEmailOtpError] = useState<string | null>(null);
  const [emailResendTimer, setEmailResendTimer] = useState(0);
  const lastSentEmailRef = useRef<string>('');

  // Inline Mobile OTP State (Sign-Up)
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneOtpLoading, setPhoneOtpLoading] = useState(false);
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneOtpError, setPhoneOtpError] = useState<string | null>(null);
  const [phoneOtpChannel, setPhoneOtpChannel] = useState<string | null>(null);
  const [phoneResendTimer, setPhoneResendTimer] = useState(0);
  const lastSentPhoneRef = useRef<string>('');

  // ─── Part 2: Sign-In State (Mobile OTP or Email OTP) ────────────────────────
  const [signInMethod, setSignInMethod] = useState<'phone' | 'email'>('phone');

  // Mobile OTP Sign-In
  const [loginPhone, setLoginPhone] = useState('');
  const [loginOtpSent, setLoginOtpSent] = useState(false);
  const [loginOtpLoading, setLoginOtpLoading] = useState(false);
  const [loginOtp, setLoginOtp] = useState('');
  const [loginOtpChannel, setLoginOtpChannel] = useState<string | null>(null);
  const [matchedAccount, setMatchedAccount] = useState<RegisteredAccountPreview | null>(null);
  const [loginResendTimer, setLoginResendTimer] = useState(0);
  const lastSentLoginPhoneRef = useRef<string>('');

  // Email OTP Sign-In
  const [loginEmail, setLoginEmail] = useState('');
  const [emailLoginOtpSent, setEmailLoginOtpSent] = useState(false);
  const [emailLoginOtpLoading, setEmailLoginOtpLoading] = useState(false);
  const [emailLoginOtp, setEmailLoginOtp] = useState('');
  const [emailMatchedAccount, setEmailMatchedAccount] = useState<RegisteredAccountPreview | null>(
    null,
  );
  const [emailLoginResendTimer, setEmailLoginResendTimer] = useState(0);

  const isSignUp = mode === 'signup';
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isValidSignupPhone = /^\d{10}$/.test(normalizePhone(signupPhone));
  const isValidLoginPhone = /^\d{10}$/.test(normalizePhone(loginPhone));
  const isValidLoginEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail.trim());

  useEffect(() => {
    setError(null);
    setErrorCode(undefined);
  }, [mode]);

  // Countdown timers
  useEffect(() => {
    if (
      emailResendTimer <= 0 &&
      phoneResendTimer <= 0 &&
      loginResendTimer <= 0 &&
      emailLoginResendTimer <= 0
    ) {
      return;
    }
    const id = setInterval(() => {
      setEmailResendTimer((t) => Math.max(0, t - 1));
      setPhoneResendTimer((t) => Math.max(0, t - 1));
      setLoginResendTimer((t) => Math.max(0, t - 1));
      setEmailLoginResendTimer((t) => Math.max(0, t - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [emailResendTimer, phoneResendTimer, loginResendTimer, emailLoginResendTimer]);

  // Helper: Switch to Sign In with prefilled email or phone when account already exists
  const switchToSigninPrefilled = (opts: {
    prefillEmail?: string | null;
    prefillPhone?: string | null;
    noticeMessage: string;
  }) => {
    setError(null);
    setErrorCode(undefined);
    setEmailOtpError(null);
    setPhoneOtpError(null);
    setNotice(opts.noticeMessage);

    if (opts.prefillPhone) {
      const cleanPhone = normalizePhone(opts.prefillPhone);
      lastSentLoginPhoneRef.current = '';
      setLoginPhone(cleanPhone);
      setSignInMethod('phone');
    } else if (opts.prefillEmail) {
      setLoginEmail(opts.prefillEmail.trim().toLowerCase());
      setSignInMethod('email');
    }
    if (isSignUp) {
      onToggleMode();
    }
  };

  // ─── SIGN-UP: Inline Email OTP Handlers ─────────────────────────────────────
  const triggerSendEmailOtp = async (targetEmail = email) => {
    const clean = targetEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || emailOtpLoading) return;

    setEmailOtpError(null);
    setError(null);
    setNotice(null);
    setEmailOtpLoading(true);
    const res = await sendEmailOtp({
      email: clean,
      name: fullName,
      businessName,
    });
    setEmailOtpLoading(false);

    if (res.error) {
      if (res.code === 'EMAIL_EXISTS') {
        switchToSigninPrefilled({
          prefillEmail: clean,
          prefillPhone: res.phone,
          noticeMessage: `Account found for ${clean}! We switched you to Sign In — enter the OTP sent to your mobile/email.`,
        });
        return;
      }
      setEmailOtpError(res.error);
      setErrorCode(res.code);
      return;
    }
    lastSentEmailRef.current = clean;
    setEmailOtpSent(true);
    setEmailVerified(false);
    setEmailOtp('');
    setEmailResendTimer(15);
  };

  const handleVerifyEmailOtpInline = async (codeToVerify = emailOtp) => {
    if (codeToVerify.length !== 6 || emailOtpLoading) return;
    setEmailOtpError(null);
    setEmailOtpLoading(true);
    const res = await verifyEmailOtp(email, codeToVerify);
    setEmailOtpLoading(false);
    if (res.error) {
      setEmailOtpError(res.error);
      return;
    }
    setEmailVerified(true);
  };

  useEffect(() => {
    if (emailOtpSent && !emailVerified && emailOtp.length === 6) {
      void handleVerifyEmailOtpInline(emailOtp);
    }
  }, [emailOtp, emailOtpSent, emailVerified]);

  // ─── SIGN-UP: Inline Mobile OTP Handlers ────────────────────────────────────
  const triggerSendPhoneOtp = async (targetPhone = signupPhone) => {
    const clean = normalizePhone(targetPhone);
    if (!/^\d{10}$/.test(clean) || phoneOtpLoading) return;

    setPhoneOtpError(null);
    setError(null);
    setNotice(null);
    setPhoneOtpLoading(true);
    const res = await sendPhoneOtp({
      phone: clean,
      email: email.trim(),
      name: fullName,
      businessName,
    });
    setPhoneOtpLoading(false);

    if (res.error) {
      if (res.code === 'PHONE_EXISTS') {
        switchToSigninPrefilled({
          prefillPhone: clean,
          noticeMessage: `Mobile number +91 ${clean} is already registered! Switched to Sign In.`,
        });
        return;
      }
      setPhoneOtpError(res.error);
      setErrorCode(res.code);
      return;
    }
    lastSentPhoneRef.current = clean;
    setPhoneOtpChannel(res.channel || null);
    setPhoneOtpSent(true);
    setPhoneVerified(false);
    setPhoneOtp('');
    setPhoneResendTimer(15);
  };

  useEffect(() => {
    if (!isSignUp) return;
    const clean = normalizeIndianPhone(signupPhone);
    if (clean.length === 10 && lastSentPhoneRef.current !== clean && !phoneOtpLoading) {
      void triggerSendPhoneOtp(clean);
    }
  }, [signupPhone, isSignUp]);

  const handleVerifyPhoneOtpInline = async (codeToVerify = phoneOtp) => {
    if (codeToVerify.length !== 6 || phoneOtpLoading) return;
    setPhoneOtpError(null);
    setPhoneOtpLoading(true);
    const res = await verifyPhoneOtp(signupPhone, codeToVerify);
    setPhoneOtpLoading(false);
    if (res.error) {
      setPhoneOtpError(res.error);
      return;
    }
    setPhoneVerified(true);
  };

  useEffect(() => {
    if (phoneOtpSent && !phoneVerified && phoneOtp.length === 6) {
      void handleVerifyPhoneOtpInline(phoneOtp);
    }
  }, [phoneOtp, phoneOtpSent, phoneVerified]);

  // ─── SIGN-UP: Complete New Account Creation ─────────────────────────────────
  const handleCreateAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrorCode(undefined);

    if (!emailVerified && emailOtp.length !== 6) {
      if (!emailOtpSent) {
        await triggerSendEmailOtp(email);
      }
      setError('Please enter and verify the 6-digit OTP sent to your email address.');
      return;
    }
    if (!phoneVerified && phoneOtp.length !== 6) {
      if (!phoneOtpSent) {
        await triggerSendPhoneOtp(signupPhone);
      }
      setError('Please enter and verify the 6-digit OTP sent to your mobile number.');
      return;
    }

    setLoading(true);
    const res = await completeSignup({
      name: fullName,
      businessName,
      gstin,
      email,
      phone: signupPhone,
      emailOtp,
      phoneOtp,
      remember,
    });
    setLoading(false);

    if (res.error) {
      if (res.code === 'EMAIL_EXISTS' || res.code === 'PHONE_EXISTS') {
        switchToSigninPrefilled({
          prefillPhone: signupPhone,
          prefillEmail: email,
          noticeMessage: 'This account is already registered. Please sign in below.',
        });
        return;
      }
      setError(res.error);
      setErrorCode(res.code);
    }
  };

  // ─── SIGN-IN: Mobile OTP Handlers ───────────────────────────────────────────
  const triggerRequestLoginOtp = async (targetPhone = loginPhone) => {
    const clean = normalizePhone(targetPhone);
    if (!/^\d{10}$/.test(clean) || loginOtpLoading) return;

    setError(null);
    setErrorCode(undefined);
    setLoginOtpLoading(true);
    const res = await requestLoginOtp(clean);
    setLoginOtpLoading(false);

    if (res.error) {
      setError(res.error);
      setErrorCode(res.code);
      setLoginOtpSent(false);
      return;
    }

    lastSentLoginPhoneRef.current = clean;
    setMatchedAccount(res.account || null);
    setLoginOtpChannel(res.channel || null);
    setLoginOtpSent(true);
    setLoginOtp('');
    setLoginResendTimer(15);
  };

  // Auto-send login OTP when 10 digits are entered on Sign-In
  useEffect(() => {
    if (isSignUp || signInMethod !== 'phone') return;
    const clean = normalizePhone(loginPhone);
    if (clean.length === 10 && lastSentLoginPhoneRef.current !== clean && !loginOtpLoading) {
      void triggerRequestLoginOtp(clean);
    }
  }, [loginPhone, isSignUp, signInMethod]);

  const executeVerifyMobileLogin = async (codeToVerify: string) => {
    if (codeToVerify.length !== 6 || loading) return;
    setError(null);
    setNotice(null);
    setLoading(true);
    const res = await verifyLoginOtp(loginPhone, codeToVerify, remember);
    setLoading(false);
    if (res.error) {
      setError(res.error);
    }
  };

  // Auto-verify Mobile Login OTP as soon as all 6 digits are entered
  useEffect(() => {
    if (!isSignUp && signInMethod === 'phone' && loginOtpSent && loginOtp.length === 6 && !loading) {
      void executeVerifyMobileLogin(loginOtp);
    }
  }, [loginOtp, loginOtpSent, isSignUp, signInMethod]);

  // ─── SIGN-IN: Email OTP Handlers ────────────────────────────────────────────
  const triggerRequestEmailLoginOtp = async (targetEmail = loginEmail) => {
    const clean = targetEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || emailLoginOtpLoading) return;

    setError(null);
    setErrorCode(undefined);
    setEmailLoginOtpLoading(true);
    const res = await requestEmailLoginOtp(clean);
    setEmailLoginOtpLoading(false);

    if (res.error) {
      setError(res.error);
      setErrorCode(res.code);
      setEmailLoginOtpSent(false);
      return;
    }

    setEmailMatchedAccount(res.account || null);
    setEmailLoginOtpSent(true);
    setEmailLoginOtp('');
    setEmailLoginResendTimer(15);
  };

  const executeVerifyEmailLogin = async (codeToVerify: string) => {
    if (codeToVerify.length !== 6 || loading) return;
    setError(null);
    setNotice(null);
    setLoading(true);
    const res = await verifyEmailLoginOtp(loginEmail, codeToVerify, remember);
    setLoading(false);
    if (res.error) {
      setError(res.error);
    }
  };

  // Auto-verify Email Login OTP when 6 digits are entered
  useEffect(() => {
    if (
      !isSignUp &&
      signInMethod === 'email' &&
      emailLoginOtpSent &&
      emailLoginOtp.length === 6 &&
      !loading
    ) {
      void executeVerifyEmailLogin(emailLoginOtp);
    }
  }, [emailLoginOtp, emailLoginOtpSent, isSignUp, signInMethod]);

  const handleVerifyLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (signInMethod === 'email') {
      if (!emailLoginOtpSent) {
        await triggerRequestEmailLoginOtp(loginEmail);
        return;
      }
      await executeVerifyEmailLogin(emailLoginOtp);
      return;
    }

    if (!loginOtpSent) {
      await triggerRequestLoginOtp(loginPhone);
      return;
    }
    await executeVerifyMobileLogin(loginOtp);
  };

  const switchToSignupWithIdentifier = () => {
    if (signInMethod === 'phone') {
      const clean = normalizePhone(loginPhone);
      if (clean) setSignupPhone(clean);
    } else if (loginEmail.trim()) {
      setEmail(loginEmail.trim().toLowerCase());
    }
    setError(null);
    setErrorCode(undefined);
    setNotice(null);
    onToggleMode();
  };

  const handleGoogleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setError(null);
      setNotice(null);
      setLoading(true);
      const { error } = await signInWithGoogle(tokenResponse.access_token, remember);
      setLoading(false);
      if (error) {
        setError(error);
      }
    },
    onError: () => {
      setError('Google login popup was closed or failed.');
    },
  });

  return (
    <div className="min-h-screen flex overflow-hidden">
      {/* Left panel — hero image */}
      <motion.div
        initial={{ x: -60, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="hidden lg:flex lg:w-[48%] relative flex-col overflow-hidden"
      >
        <img
          src={heroShopkeeper}
          alt="VyapaarAI Kirana shopkeeper"
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#1A0800]/80 via-[#2A1000]/50 to-[#F5A623]/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1A0800]/90 via-transparent to-transparent" />

        <div className="relative z-10 flex flex-col h-full p-10">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="flex items-center gap-2.5"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow">
              <span className="font-serif text-white text-xl font-bold leading-none">v</span>
            </div>
            <span className="font-serif text-xl font-bold text-white">
              Vyapaar<span className="text-primary">AI</span>
            </span>
          </motion.div>

          {/* Middle text */}
          <div className="flex-1 flex flex-col justify-center">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.7 }}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/20 border border-primary/30 mb-6">
                <motion.span
                  animate={{ scale: [1, 1.4, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="w-1.5 h-1.5 rounded-full bg-primary"
                />
                <span className="text-xs font-semibold text-primary-100 tracking-wide">
                  India&apos;s Kirana OS
                </span>
              </div>
              <h2 className="font-serif text-4xl xl:text-5xl font-bold text-white leading-[1.1] mb-4">
                The{' '}
                <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                  Bahi Khata
                </span>
                <br />
                of the Future
              </h2>
              <p className="text-white/70 text-base leading-relaxed max-w-sm">
                Join 10,000+ kirana store owners who track sales, manage udhaar, and grow smarter —
                all by voice.
              </p>
            </motion.div>

            {/* Floating stat cards */}
            <div className="mt-10 grid grid-cols-2 gap-3">
              {floatingStats.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 0.7 + i * 0.12, duration: 0.5 }}
                  whileHover={{ scale: 1.04, y: -2 }}
                  className="rounded-xl bg-white/10 backdrop-blur-sm border border-white/15 p-3.5"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${stat.color}22` }}
                    >
                      <stat.icon className="w-3.5 h-3.5" style={{ color: stat.color }} />
                    </div>
                    <span className="text-[10px] text-white/60 font-medium">{stat.label}</span>
                  </div>
                  <div className="font-serif text-lg font-bold text-white">{stat.value}</div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Bottom trust line */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.3, duration: 0.5 }}
            className="flex items-center gap-2 text-white/50 text-xs"
          >
            <CheckCircle2 className="w-4 h-4 text-sale" />
            Instant Email &amp; Mobile OTP Verification · Works in 12 Indian languages
          </motion.div>
        </div>
      </motion.div>

      {/* Right panel — form */}
      <div className="flex-1 flex flex-col min-h-screen kirana-bg overflow-y-auto">
        <div className="lg:hidden">
          <div className="marigold-blur marigold-tl" style={{ opacity: 0.4 }} />
          <div className="marigold-blur marigold-br" style={{ opacity: 0.4 }} />
        </div>

        <div className="flex-1 flex flex-col justify-center px-6 py-8 max-w-lg mx-auto w-full">
          {/* Back button */}
          <motion.button
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 }}
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-secondary transition-colors mb-4 self-start"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </motion.button>

          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-4 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow">
              <span className="font-serif text-white text-lg font-bold leading-none">v</span>
            </div>
            <span className="font-serif text-lg font-bold text-ink">
              Vyapaar<span className="text-primary-deep">AI</span>
            </span>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="glass-card p-6 sm:p-7"
          >
            {/* Clear Top Mode Switcher: Sign In vs Create New Account */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-ink-100/80 mb-5">
              <button
                type="button"
                onClick={() => {
                  if (isSignUp) {
                    setError(null);
                    setErrorCode(undefined);
                    setNotice(null);
                    onToggleMode();
                  }
                }}
                className={`py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                  !isSignUp
                    ? 'bg-gradient-to-r from-primary to-secondary text-white shadow-sm'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                Sign In (Existing User)
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!isSignUp) {
                    setError(null);
                    setErrorCode(undefined);
                    setNotice(null);
                    onToggleMode();
                  }
                }}
                className={`py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                  isSignUp
                    ? 'bg-gradient-to-r from-primary to-secondary text-white shadow-sm'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                Create New Account
              </button>
            </div>

            {/* Header */}
            <div className="flex flex-col items-center mb-5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow mb-2.5 p-2.5">
                <Store className="w-6 h-6 text-white" strokeWidth={2.3} />
              </div>
              <h1 className="font-serif text-2xl font-bold text-ink text-center">
                {isSignUp ? 'Register Your Shop' : 'Welcome Back to VyapaarAI'}
              </h1>
              <p className="text-xs sm:text-sm text-ink-soft mt-1 text-center">
                {isSignUp
                  ? 'Verify your Email & Mobile Number with 6-digit OTPs below'
                  : 'Enter your registered Mobile Number or Email to receive a 6-digit OTP'}
              </p>
            </div>

            {/* Notice banner */}
            {notice && (
              <div className="mb-4 p-3 rounded-xl bg-primary-50/90 border border-primary-200 text-ink text-xs sm:text-sm flex items-start gap-2">
                <Info className="w-4 h-4 text-secondary mt-0.5 flex-shrink-0" />
                <span>{notice}</span>
              </div>
            )}

            <AnimatePresence mode="wait">
              {/* ================================================================
                  PART 1: NEW USER CREATE ACCOUNT (WITH INLINE EMAIL & PHONE OTP)
              ================================================================ */}
              {isSignUp ? (
                <motion.div
                  key="signup-form"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  <form onSubmit={handleCreateAccountSubmit} className="space-y-3.5">
                    {error && (
                      <div className="p-3 rounded-xl bg-overdue-light border border-overdue/30 text-overdue-deep text-xs sm:text-sm space-y-2">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>{error}</span>
                        </div>
                      </div>
                    )}

                    {/* Name & Business Name */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-soft mb-1">
                          Your Full Name *
                        </label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
                          <input
                            type="text"
                            required
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder="Jathin"
                            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-ink-200 bg-paper-card text-ink text-sm placeholder:text-ink-faint focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-soft mb-1">
                          Business / Shop Name *
                        </label>
                        <div className="relative">
                          <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
                          <input
                            type="text"
                            required
                            value={businessName}
                            onChange={(e) => setBusinessName(e.target.value)}
                            placeholder="Sri Sai Kirana"
                            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-ink-200 bg-paper-card text-ink text-sm placeholder:text-ink-faint focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                          />
                        </div>
                      </div>
                    </div>

                    {/* ── EMAIL INPUT + INLINE OTP POPUP BELOW ──────────────── */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                          Email Address *
                        </label>
                        {emailVerified && (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-sale-deep bg-sale-light px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3.5 h-3.5 text-sale" /> Email Verified
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
                          <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => {
                              setEmail(e.target.value);
                              if (lastSentEmailRef.current !== e.target.value.trim().toLowerCase()) {
                                setEmailVerified(false);
                                setEmailOtpSent(false);
                                setEmailOtp('');
                                setEmailOtpError(null);
                              }
                            }}
                            onBlur={() => {
                              if (
                                isValidEmail &&
                                !emailOtpSent &&
                                !emailVerified &&
                                lastSentEmailRef.current !== email.trim().toLowerCase()
                              ) {
                                void triggerSendEmailOtp(email);
                              }
                            }}
                            placeholder="owner@gmail.com"
                            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-ink-200 bg-paper-card text-ink text-sm placeholder:text-ink-faint focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                          />
                        </div>

                        {!emailVerified && (
                          <button
                            type="button"
                            disabled={!isValidEmail || emailOtpLoading || emailResendTimer > 0}
                            onClick={() => triggerSendEmailOtp(email)}
                            className="px-3.5 py-2.5 rounded-xl bg-secondary text-white text-xs font-semibold whitespace-nowrap hover:bg-secondary-deep transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {emailOtpLoading
                              ? 'Sending...'
                              : emailResendTimer > 0
                                ? `Resend (${emailResendTimer}s)`
                                : emailOtpSent
                                  ? 'Resend OTP'
                                  : 'Send OTP'}
                          </button>
                        )}
                      </div>

                      {emailOtpError && (
                        <p className="text-xs text-overdue-deep flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {emailOtpError}
                        </p>
                      )}

                      {/* Inline 6-digit Email OTP Box popped up directly below Email input */}
                      <AnimatePresence>
                        {emailOtpSent && !emailVerified && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="p-3 rounded-xl bg-primary-50/70 border border-primary-200/80 space-y-2">
                              <div className="flex items-center justify-between text-[11px] text-ink-soft">
                                <span>
                                  Enter 6-digit OTP sent to{' '}
                                  <strong className="text-ink">{email.trim()}</strong>
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <SixDigitOtpInput
                                  value={emailOtp}
                                  onChange={setEmailOtp}
                                  disabled={emailOtpLoading}
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  disabled={emailOtp.length !== 6 || emailOtpLoading}
                                  onClick={() => handleVerifyEmailOtpInline(emailOtp)}
                                  className="px-3.5 h-10 rounded-lg bg-sale text-white text-xs font-semibold hover:bg-sale-deep transition-colors disabled:opacity-50"
                                >
                                  Verify
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* ── MOBILE NUMBER INPUT + INLINE OTP POPUP BELOW ──────── */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                          Mobile Number *
                        </label>
                        {phoneVerified && (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-sale-deep bg-sale-light px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3.5 h-3.5 text-sale" /> Mobile Verified
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="relative flex flex-1">
                          <span className="inline-flex items-center px-2.5 rounded-l-xl border border-r-0 border-ink-200 bg-ink-100/70 text-ink font-semibold text-xs">
                            +91
                          </span>
                          <input
                            type="tel"
                            required
                            maxLength={10}
                            value={signupPhone}
                            onChange={(e) => {
                              const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                              setSignupPhone(clean);
                              if (lastSentPhoneRef.current !== clean) {
                                setPhoneVerified(false);
                                setPhoneOtpSent(false);
                                setPhoneOtp('');
                                setPhoneOtpError(null);
                              }
                            }}
                            placeholder="9642865348"
                            className="w-full px-3 py-2.5 rounded-r-xl border border-ink-200 bg-paper-card text-ink text-sm placeholder:text-ink-faint focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                          />
                        </div>

                        {!phoneVerified && (
                          <button
                            type="button"
                            disabled={!isValidSignupPhone || phoneOtpLoading || phoneResendTimer > 0}
                            onClick={() => triggerSendPhoneOtp(signupPhone)}
                            className="px-3.5 py-2.5 rounded-xl bg-secondary text-white text-xs font-semibold whitespace-nowrap hover:bg-secondary-deep transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {phoneOtpLoading
                              ? 'Sending...'
                              : phoneResendTimer > 0
                                ? `Resend (${phoneResendTimer}s)`
                                : phoneOtpSent
                                  ? 'Resend OTP'
                                  : 'Send OTP'}
                          </button>
                        )}
                      </div>

                      {phoneOtpError && (
                        <p className="text-xs text-overdue-deep flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {phoneOtpError}
                        </p>
                      )}

                      {/* Inline 6-digit Mobile OTP Box popped up directly below Phone input */}
                      <AnimatePresence>
                        {phoneOtpSent && !phoneVerified && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="p-3 rounded-xl bg-primary-50/70 border border-primary-200/80 space-y-2">
                              <div className="flex items-center justify-between text-[11px] text-ink-soft">
                                <span>
                                  Enter 6-digit Mobile OTP for{' '}
                                  <strong className="text-ink">+91 {signupPhone}</strong>
                                  {phoneOtpChannel && phoneOtpChannel !== 'sms' ? (
                                    <span className="text-sale-deep">
                                      {' '}
                                      (also sent to {phoneOtpChannel})
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <SixDigitOtpInput
                                  value={phoneOtp}
                                  onChange={setPhoneOtp}
                                  disabled={phoneOtpLoading}
                                  autoFocus={!emailOtpSent || emailVerified}
                                />
                                <button
                                  type="button"
                                  disabled={phoneOtp.length !== 6 || phoneOtpLoading}
                                  onClick={() => handleVerifyPhoneOtpInline(phoneOtp)}
                                  className="px-3.5 h-10 rounded-lg bg-sale text-white text-xs font-semibold hover:bg-sale-deep transition-colors disabled:opacity-50"
                                >
                                  Verify
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Optional GSTIN */}
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-soft mb-1">
                        GSTIN <span className="text-ink-faint normal-case">(optional)</span>
                      </label>
                      <div className="relative">
                        <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
                        <input
                          type="text"
                          maxLength={15}
                          value={gstin}
                          onChange={(e) => setGstin(e.target.value.toUpperCase())}
                          placeholder="29ABCDE1234F1Z5"
                          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-ink-200 bg-paper-card text-ink text-sm uppercase placeholder:normal-case placeholder:text-ink-faint focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                        />
                      </div>
                    </div>

                    {/* Remember me checkbox */}
                    <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer select-none pt-1">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                        className="w-4 h-4 rounded border-ink-200 text-secondary focus:ring-secondary"
                      />
                      <span>Keep me signed in for 30 days on this device</span>
                    </label>

                    <motion.button
                      type="submit"
                      disabled={loading}
                      whileHover={!loading ? { scale: 1.01 } : {}}
                      whileTap={!loading ? { scale: 0.99 } : {}}
                      className="btn-primary w-full py-3 mt-2 disabled:opacity-60"
                    >
                      {loading ? (
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>
                          Create Account &amp; Open Dashboard <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </motion.button>
                  </form>

                  <div className="flex items-center gap-3 my-4">
                    <div className="h-px flex-1 bg-ink-100" />
                    <span className="text-xs text-ink-faint font-medium">or sign up with</span>
                    <div className="h-px flex-1 bg-ink-100" />
                  </div>

                  <button
                    type="button"
                    onClick={() => handleGoogleLogin()}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-xl border border-ink-200 bg-paper-card hover:bg-white text-ink text-sm font-semibold transition-colors disabled:opacity-60"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    Continue with Google
                  </button>


                </motion.div>
              ) : (
                /* ================================================================
                   PART 2: SIGN-IN (REGISTERED MOBILE NUMBER OTP OR EMAIL OTP)
                ================================================================ */
                <motion.div
                  key="signin-form"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                >
                  {/* Method Switcher: Mobile OTP vs Email OTP */}
                  <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-ink-100/60 mb-4">
                    <button
                      type="button"
                      onClick={() => {
                        setSignInMethod('phone');
                        setError(null);
                        setErrorCode(undefined);
                      }}
                      className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                        signInMethod === 'phone'
                          ? 'bg-white text-ink shadow-sm'
                          : 'text-ink-soft hover:text-ink'
                      }`}
                    >
                      <Smartphone className="w-3.5 h-3.5 text-secondary" />
                      Mobile Number OTP
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSignInMethod('email');
                        setError(null);
                        setErrorCode(undefined);
                      }}
                      className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                        signInMethod === 'email'
                          ? 'bg-white text-ink shadow-sm'
                          : 'text-ink-soft hover:text-ink'
                      }`}
                    >
                      <Mail className="w-3.5 h-3.5 text-secondary" />
                      Email Address OTP
                    </button>
                  </div>

                  <form onSubmit={handleVerifyLoginSubmit} className="space-y-4">
                    {error && (
                      <div className="p-3.5 rounded-xl bg-overdue-light border border-overdue/30 text-overdue-deep text-xs sm:text-sm space-y-2.5">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>{error}</span>
                        </div>
                        {errorCode === 'ACCOUNT_NOT_FOUND' && (
                          <button
                            type="button"
                            onClick={switchToSignupWithIdentifier}
                            className="w-full py-2.5 px-3 rounded-lg bg-secondary text-white font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-secondary-deep transition-colors shadow-sm"
                          >
                            Create New Account Now <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}

                    {signInMethod === 'phone' ? (
                      /* Mobile Number Input + Send OTP Button beside it */
                      <div className="space-y-2.5">
                        <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft">
                          Registered Mobile Number
                        </label>
                        <div className="flex items-center gap-2">
                          <div className="relative flex flex-1">
                            <span className="inline-flex items-center gap-1 px-3 rounded-l-xl border border-r-0 border-ink-200 bg-ink-100/70 text-ink font-semibold text-sm">
                              <Smartphone className="w-4 h-4 text-secondary" /> +91
                            </span>
                            <input
                              type="tel"
                              required
                              maxLength={10}
                              value={loginPhone}
                              onChange={(e) => {
                                const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                                setLoginPhone(clean);
                                if (lastSentLoginPhoneRef.current !== clean) {
                                  setLoginOtpSent(false);
                                  setLoginOtp('');
                                  setMatchedAccount(null);
                                  setError(null);
                                  setErrorCode(undefined);
                                }
                              }}
                              placeholder="Enter 10-digit mobile number"
                              className="w-full px-3.5 py-2.5 rounded-r-xl border border-ink-200 bg-paper-card text-ink text-sm font-medium tracking-wide placeholder:font-normal placeholder:tracking-normal placeholder:text-ink-faint focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                            />
                          </div>

                          <button
                            type="button"
                            disabled={!isValidLoginPhone || loginOtpLoading || loginResendTimer > 0}
                            onClick={() => triggerRequestLoginOtp(loginPhone)}
                            className="px-3.5 py-2.5 rounded-xl bg-secondary text-white text-xs font-semibold whitespace-nowrap hover:bg-secondary-deep transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {loginOtpLoading
                              ? 'Sending...'
                              : loginResendTimer > 0
                                ? `Resend (${loginResendTimer}s)`
                                : loginOtpSent
                                  ? 'Resend OTP'
                                  : 'Send OTP'}
                          </button>
                        </div>

                        {/* Inline 6-digit Mobile OTP Box popped up directly below Mobile input */}
                        <AnimatePresence>
                          {loginOtpSent && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="p-3.5 rounded-xl bg-primary-50/70 border border-primary-200/80 space-y-2.5 mt-1">
                                {matchedAccount && (
                                  <div className="flex items-center justify-between text-xs bg-white/80 px-2.5 py-1.5 rounded-lg border border-sale/30">
                                    <span className="font-bold text-ink flex items-center gap-1.5">
                                      <ShieldCheck className="w-4 h-4 text-sale" />
                                      {matchedAccount.businessName} ({matchedAccount.name})
                                    </span>
                                    <span className="text-[11px] font-bold text-sale-deep">
                                      Verified Shop
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between text-[11px] text-ink-soft">
                                  <span>
                                    Enter 6-digit OTP sent for{' '}
                                    <strong className="text-ink">+91 {loginPhone}</strong>
                                    {loginOtpChannel && loginOtpChannel !== 'sms' ? (
                                      <span className="text-sale-deep">
                                        {' '}
                                        (delivered to {loginOtpChannel})
                                      </span>
                                    ) : null}
                                  </span>
                                  {loginResendTimer === 0 && (
                                    <button
                                      type="button"
                                      onClick={() => triggerRequestLoginOtp(loginPhone)}
                                      className="text-secondary font-semibold flex items-center gap-1 hover:underline"
                                    >
                                      <RefreshCw className="w-3 h-3" /> Resend
                                    </button>
                                  )}
                                </div>
                                <SixDigitOtpInput
                                  value={loginOtp}
                                  onChange={setLoginOtp}
                                  disabled={loading}
                                  autoFocus
                                />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ) : (
                      /* Registered Email Address + Inline 6-digit Email OTP */
                      <div className="space-y-2.5">
                        <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft">
                          Registered Email Address
                        </label>
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
                            <input
                              type="email"
                              required
                              value={loginEmail}
                              onChange={(e) => {
                                setLoginEmail(e.target.value);
                                setEmailLoginOtpSent(false);
                                setEmailLoginOtp('');
                                setEmailMatchedAccount(null);
                                setError(null);
                                setErrorCode(undefined);
                              }}
                              placeholder="djathin58@gmail.com"
                              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-ink-200 bg-paper-card text-ink text-sm placeholder:text-ink-faint focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/20"
                            />
                          </div>

                          <button
                            type="button"
                            disabled={
                              !isValidLoginEmail ||
                              emailLoginOtpLoading ||
                              emailLoginResendTimer > 0
                            }
                            onClick={() => triggerRequestEmailLoginOtp(loginEmail)}
                            className="px-3.5 py-2.5 rounded-xl bg-secondary text-white text-xs font-semibold whitespace-nowrap hover:bg-secondary-deep transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {emailLoginOtpLoading
                              ? 'Sending...'
                              : emailLoginResendTimer > 0
                                ? `Resend (${emailLoginResendTimer}s)`
                                : emailLoginOtpSent
                                  ? 'Resend OTP'
                                  : 'Send OTP'}
                          </button>
                        </div>

                        {/* Inline 6-digit Email Login OTP Box */}
                        <AnimatePresence>
                          {emailLoginOtpSent && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="p-3.5 rounded-xl bg-primary-50/70 border border-primary-200/80 space-y-2.5 mt-1">
                                {emailMatchedAccount && (
                                  <div className="flex items-center justify-between text-xs bg-white/80 px-2.5 py-1.5 rounded-lg border border-sale/30">
                                    <span className="font-bold text-ink flex items-center gap-1.5">
                                      <ShieldCheck className="w-4 h-4 text-sale" />
                                      {emailMatchedAccount.businessName} ({emailMatchedAccount.name})
                                    </span>
                                    <span className="text-[11px] font-bold text-sale-deep">
                                      Verified Shop
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between text-[11px] text-ink-soft">
                                  <span>
                                    Enter 6-digit OTP sent to{' '}
                                    <strong className="text-ink">{loginEmail.trim()}</strong>
                                  </span>
                                </div>
                                <SixDigitOtpInput
                                  value={emailLoginOtp}
                                  onChange={setEmailLoginOtp}
                                  disabled={loading}
                                  autoFocus
                                />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}

                    {/* Remember me checkbox */}
                    <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                        className="w-4 h-4 rounded border-ink-200 text-secondary focus:ring-secondary"
                      />
                      <span>Remember me for 30 days</span>
                    </label>

                    <motion.button
                      type="submit"
                      disabled={
                        loading ||
                        (signInMethod === 'phone'
                          ? !isValidLoginPhone || (loginOtpSent && loginOtp.length !== 6)
                          : !isValidLoginEmail || (emailLoginOtpSent && emailLoginOtp.length !== 6))
                      }
                      whileHover={!loading ? { scale: 1.01 } : {}}
                      whileTap={!loading ? { scale: 0.99 } : {}}
                      className="btn-primary w-full py-3 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {loading ? (
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (signInMethod === 'phone' && loginOtpSent) ||
                        (signInMethod === 'email' && emailLoginOtpSent) ? (
                        <>
                          <CheckCircle2 className="w-4 h-4" /> Verify OTP &amp; Open Dashboard
                        </>
                      ) : (
                        <>
                          Send 6-Digit OTP <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </motion.button>
                  </form>

                  <div className="flex items-center gap-3 my-5">
                    <div className="h-px flex-1 bg-ink-100" />
                    <span className="text-xs text-ink-faint font-medium">or continue with</span>
                    <div className="h-px flex-1 bg-ink-100" />
                  </div>

                  <button
                    type="button"
                    onClick={() => handleGoogleLogin()}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-xl border border-ink-200 bg-paper-card hover:bg-white text-ink text-sm font-semibold transition-colors disabled:opacity-60"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    Continue with Google
                  </button>


                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
