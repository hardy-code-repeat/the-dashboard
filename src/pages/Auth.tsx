import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, Loader2, UserX } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch (err) {
      console.error("Email sign-in error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to send verification code. Please try again.",
      );
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      navigate(redirect);
    } catch {
      console.error("OTP verification error");
      setError("The verification code you entered is incorrect.");
      setIsLoading(false);
      setOtp("");
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn("anonymous");
      navigate(redirect);
    } catch (err) {
      console.error("Guest login error:", err);
      setError(
        `Failed to sign in as guest: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* top accent strip */}
      <div className="flex h-3 w-full">
        <div className="w-1/2 bg-primary" />
        <div className="w-1/4 bg-secondary" />
        <div className="w-1/4 bg-accent" />
      </div>

      <main className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-md">
          {/* brand */}
          <button
            type="button"
            onClick={() => navigate("/")}
            className="mb-8 flex items-center gap-3"
          >
            <span className="brutal-flat flex size-12 items-center justify-center bg-primary">
              <span className="font-display text-xl leading-none">P</span>
            </span>
            <span className="font-display text-2xl uppercase tracking-tight">Panel</span>
          </button>

          <div className="brutal bg-card p-6 sm:p-8">
            {step === "signIn" ? (
              <>
                <h1 className="font-display text-2xl uppercase tracking-tight">Get started</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Enter your email. We'll send you a code — no password needed.
                </p>

                <form onSubmit={handleEmailSubmit} className="mt-6">
                  <div className="flex flex-col gap-3">
                    <Input
                      name="email"
                      placeholder="you@example.com"
                      type="email"
                      aria-label="Email address"
                      disabled={isLoading}
                      required
                      className="h-12 border-2 border-border bg-background px-4 focus-visible:ring-0"
                    />
                    <Button
                      type="submit"
                      disabled={isLoading}
                      className="brutal h-12 gap-2 bg-primary font-bold uppercase"
                    >
                      {isLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ArrowRight className="size-4" />
                      )}
                      Send code
                    </Button>
                  </div>

                  {error && (
                    <p className="mt-4 border-2 border-border bg-destructive px-3 py-2 text-xs text-white">
                      {error}
                    </p>
                  )}

                  <div className="my-6 flex items-center gap-3">
                    <span className="h-0.5 flex-1 bg-border" />
                    <span className="text-[11px] font-bold uppercase text-muted-foreground">or</span>
                    <span className="h-0.5 flex-1 bg-border" />
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleGuestLogin}
                    disabled={isLoading}
                    className="brutal h-12 w-full gap-2 border-2 border-border bg-background font-bold uppercase"
                  >
                    <UserX className="size-4" />
                    Continue as guest
                  </Button>
                </form>
              </>
            ) : (
              <>
                <h1 className="font-display text-2xl uppercase tracking-tight">Check your inbox</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  We sent a six-digit code to{" "}
                  <span className="font-bold text-foreground">{step.email}</span>.
                </p>

                <form onSubmit={handleOtpSubmit} className="mt-6">
                  <input type="hidden" name="email" value={step.email} />
                  <input type="hidden" name="code" value={otp} />

                  <div className="flex justify-center">
                    <InputOTP
                      value={otp}
                      onChange={setOtp}
                      maxLength={6}
                      disabled={isLoading}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                          const form = (e.target as HTMLElement).closest("form");
                          if (form) form.requestSubmit();
                        }
                      }}
                    >
                      <InputOTPGroup>
                        {Array.from({ length: 6 }).map((_, index) => (
                          <InputOTPSlot
                            key={index}
                            index={index}
                            className="size-12 border-2 border-border bg-background text-lg font-bold data-[active=true]:ring-0 data-[active=true]:border-foreground"
                          />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>

                  {error && (
                    <p className="mt-4 border-2 border-border bg-destructive px-3 py-2 text-center text-xs text-white">
                      {error}
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={isLoading || otp.length !== 6}
                    className="brutal mt-6 h-12 w-full gap-2 bg-primary font-bold uppercase"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Verifying
                      </>
                    ) : (
                      <>
                        Verify code
                        <ArrowRight className="size-4" />
                      </>
                    )}
                  </Button>

                  <button
                    type="button"
                    onClick={() => setStep("signIn")}
                    disabled={isLoading}
                    className="mt-4 w-full text-center text-[11px] font-bold uppercase text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    Use a different email
                  </button>
                </form>
              </>
            )}
          </div>

          <p className="mt-6 text-center text-[11px] uppercase text-muted-foreground">
            Signed in?{" "}
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="font-bold underline underline-offset-4 hover:text-foreground"
            >
              Open the dashboard
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}