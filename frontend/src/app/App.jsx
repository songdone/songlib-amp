import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Brand } from "../components/Brand";
import { PwaInstallPrompt } from "../components/PwaInstallPrompt";
import { Login } from "../features/auth/Login";
import { SetupWizard } from "../features/auth/SetupWizard";
import { PlayerProvider } from "../features/player/PlayerProvider";
import { api } from "../lib/api";
import { AuthenticatedShell } from "./AuthenticatedShell";

export function App() {
  const [authenticated, setAuthenticated] = useState(null);
  const [setupRequired, setSetupRequired] = useState(false);
  useEffect(() => {
    api("/api/auth/status", { timeoutMs: 8000 })
      .then((d) => {
        setAuthenticated(d.authenticated);
        setSetupRequired(Boolean(d.setupRequired));
      })
      .catch(() => setAuthenticated(false));
  }, []);
  if (authenticated === null)
    return (
      <div className="boot">
        <Brand />
        <LoaderCircle className="spin" />
      </div>
    );
  if (setupRequired)
    return (
      <SetupWizard
        onComplete={() => {
          setSetupRequired(false);
          setAuthenticated(true);
        }}
      />
    );
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return (
    <PlayerProvider>
      <AuthenticatedShell setAuthenticated={setAuthenticated} />
      <PwaInstallPrompt />
    </PlayerProvider>
  );
}
