import { dispatchSmsOtp, reloadEnvFile } from "./otpDispatcher";
import { normalizeE164Phone } from "./otp";

export type SmsProviderType = "twilio" | "fast2sms" | "2factor" | "console" | "auto";

export function getConfiguredSmsProvider(): SmsProviderType {
  reloadEnvFile();
  const explicit = (process.env.SMS_PROVIDER || "").trim().toLowerCase();
  if (process.env.NODE_ENV === "production" && explicit === "console") {
    throw new Error("SMS_PROVIDER=console is not permitted in production.");
  }
  if (explicit === "twilio" || explicit === "fast2sms" || explicit === "2factor" || explicit === "console") {
    return explicit;
  }
  return "auto";
}

export async function sendSms(params: {
  phone: string;
  code: string;
  recipientName?: string;
  businessName?: string;
  fallbackEmail?: string;
  isNewAccount?: boolean;
}): Promise<{ delivered: boolean; provider: string; channel?: string; error?: string }> {
  const provider = getConfiguredSmsProvider();
  const norm = normalizeE164Phone(params.phone);
  const digits10 = norm.digits10 || params.phone.replace(/\D/g, "").slice(-10);

  // Support TWILIO_FROM as an alias for TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID
  if (process.env.TWILIO_FROM && !process.env.TWILIO_FROM_NUMBER) {
    process.env.TWILIO_FROM_NUMBER = process.env.TWILIO_FROM;
  }

  if (provider === "console") {
    console.log(
      `\n📱 [VyapaarAI SMS_PROVIDER=console -> +91 ${digits10}] OTP Code: ${params.code}\n`,
    );
    return { delivered: true, provider: "console", channel: "console" };
  }

  return dispatchSmsOtp({
    toPhone: digits10,
    fallbackEmail: params.fallbackEmail,
    recipientName: params.recipientName,
    businessName: params.businessName,
    otp: params.code,
    isNewAccount: params.isNewAccount,
  });
}

