import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, ScanFace, Smartphone } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { StarsBackground } from "@/components/animate-ui/components/backgrounds/stars";
import { Button } from "@/components/animate-ui/components/buttons/button";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import { queryClient } from "@/lib/api";
import { registerPasskey, signInWithPasskey } from "@/lib/passkey";
import { Input, Logo } from "./ui";

type Mode = "signin" | "enroll";

export function LoginScreen({ setupRequired }: { setupRequired: boolean }) {
  const [mode, setMode] = useState<Mode>(setupRequired ? "enroll" : "signin");
  const [code, setCode] = useState("");
  const supported = browserSupportsWebAuthn();

  const done = () => queryClient.invalidateQueries({ queryKey: ["auth"] });
  const signIn = useMutation({ mutationFn: signInWithPasskey, onSuccess: done });
  const enroll = useMutation({ mutationFn: () => registerPasskey({ enrollToken: code }), onSuccess: done });
  const error = mode === "signin" ? signIn.error : enroll.error;

  return (
    <StarsBackground
      starColor="oklch(0.85 0.06 60)"
      className="flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_bottom,_oklch(0.22_0.03_50)_0%,_oklch(0.13_0.005_60)_100%)] px-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 120, damping: 18 }}
        className="relative z-10 w-full max-w-sm"
      >
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <motion.div
            initial={{ rotate: -12, scale: 0.6 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 12, delay: 0.1 }}
          >
            <Logo className="size-14 drop-shadow-[0_0_24px_oklch(0.7_0.14_42/0.45)]" />
          </motion.div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">rc manager</h1>
            <p className="text-muted-foreground mt-1 font-mono text-xs">
              {window.location.host}
            </p>
          </div>
        </div>

        <div className="bg-card/70 rounded-2xl border p-5 shadow-2xl backdrop-blur-xl">
          {!supported ? (
            <p className="text-muted-foreground text-center text-sm">
              This browser doesn't support passkeys. Open this page in Safari or Chrome over HTTPS.
            </p>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              {mode === "signin" ? (
                <motion.div
                  key="signin"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  className="grid gap-3"
                >
                  <Button size="lg" className="h-12 text-base" disabled={signIn.isPending} onClick={() => signIn.mutate()}>
                    <ScanFace className="size-5" />
                    {signIn.isPending ? <ShimmeringText text="Waiting for Face ID…" /> : "Sign in with passkey"}
                  </Button>
                  <button
                    className="text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 py-1 text-xs transition-colors"
                    onClick={() => {
                      signIn.reset();
                      setMode("enroll");
                    }}
                  >
                    <Smartphone className="size-3.5" /> Set up a new device
                  </button>
                </motion.div>
              ) : (
                <motion.form
                  key="enroll"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (code.trim()) enroll.mutate();
                  }}
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{setupRequired ? "First-time setup" : "Add this device"}</p>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      {setupRequired
                        ? "Enter the setup code from the server log (or its setup-token file), then create a passkey with Face ID / Touch ID."
                        : "On a signed-in device, open Settings → Security → Invite a device, and enter the code here."}
                    </p>
                  </div>
                  <Input
                    autoFocus
                    autoCapitalize="characters"
                    autoComplete="one-time-code"
                    spellCheck={false}
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    className="h-11 text-center font-mono tracking-widest uppercase"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <Button size="lg" className="h-12 text-base" type="submit" disabled={!code.trim() || enroll.isPending}>
                    <KeyRound className="size-5" />
                    {enroll.isPending ? <ShimmeringText text="Creating passkey…" /> : "Create passkey"}
                  </Button>
                  {!setupRequired && (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground py-1 text-xs transition-colors"
                      onClick={() => {
                        enroll.reset();
                        setMode("signin");
                      }}
                    >
                      Back to sign in
                    </button>
                  )}
                </motion.form>
              )}
            </AnimatePresence>
          )}

          <AnimatePresence>
            {error && error.message !== "Cancelled" && (
              <motion.p
                key={error.message}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto", x: [0, -6, 6, -4, 4, 0] }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.35 }}
                className="text-destructive mt-3 text-center text-xs"
              >
                {error.message}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </StarsBackground>
  );
}
