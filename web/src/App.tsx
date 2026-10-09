import { AnimatePresence, motion } from "motion/react";
import { Dashboard } from "@/components/dashboard";
import { LoginScreen } from "@/components/login-screen";
import { Logo } from "@/components/ui";
import { useAuthStatus } from "@/hooks/queries";

export default function App() {
  const auth = useAuthStatus();

  return (
    <AnimatePresence mode="wait">
      {auth.isPending ? (
        <motion.div key="boot" exit={{ opacity: 0 }} className="flex min-h-dvh items-center justify-center">
          <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 1.4, repeat: Infinity }}>
            <Logo className="size-12" />
          </motion.div>
        </motion.div>
      ) : auth.isError ? (
        <motion.div key="down" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex min-h-dvh items-center justify-center p-6">
          <p className="text-muted-foreground text-center text-sm">
            Can't reach the server.
            <br />
            <span className="text-destructive">{auth.error.message}</span>
          </p>
        </motion.div>
      ) : auth.data.authenticated ? (
        <motion.div key="app" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <Dashboard />
        </motion.div>
      ) : (
        <motion.div key="login" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.02 }}>
          <LoginScreen setupRequired={auth.data.setupRequired} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
