import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

/**
 * Where the email relay API key is held.
 *
 * Named rather than inlined so the deployment Keys tab and this module cannot
 * drift apart. In the intended architecture this value lives in the deployment's
 * environment, so the source should not contain a literal credential.
 *
 * The literal that previously lived here was rotated out of source under D54.
 * If this variable is not set in the deployment, email OTP fails closed — it
 * never silently falls back to a built-in key.
 */
const EMAIL_RELAY_API_KEY_ENV = "PANEL_EMAIL_RELAY_API_KEY";

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  // This function can be asynchronous
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    const apiKey = globalThis.process?.env?.[EMAIL_RELAY_API_KEY_ENV] ?? null;

    if (apiKey === null || apiKey === "") {
      throw new Error(
        `Email OTP is not configured: set ${EMAIL_RELAY_API_KEY_ENV} in the deployment.`,
      );
    }

    try {
      await axios.post(
        "https://auth.freebuff.app/send_otp",
        {
          to: email,
          otp: token,
          // The app name is what the recipient reads in the subject and body of
          // the one-time-code email, so the fallback is user-visible product
          // text, not configuration. It names the product that exists.
          appName: process.env.VLY_APP_NAME || "Panel",
        },
        {
          headers: {
            "x-api-key": apiKey,
          },
        },
      );
    } catch (error) {
      throw new Error(JSON.stringify(error));
    }
  },
});
