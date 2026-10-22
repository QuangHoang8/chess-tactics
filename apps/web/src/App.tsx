import { useState } from "react";
import { getStoredToken } from "./api/client";
import { LoginPage } from "./pages/LoginPage";
import { TrainingPage } from "./pages/TrainingPage";

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => getStoredToken() !== null);

  if (!isAuthenticated) {
    return <LoginPage onLoggedIn={() => setIsAuthenticated(true)} />;
  }
  return <TrainingPage />;
}
