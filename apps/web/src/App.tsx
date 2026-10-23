import { useState } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { getStoredToken } from "./api/client";
import { LoginPage } from "./pages/LoginPage";
import { PuzzleEditorPage } from "./pages/PuzzleEditorPage";
import { PuzzleListPage } from "./pages/PuzzleListPage";
import { TrainingPage } from "./pages/TrainingPage";

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => getStoredToken() !== null);

  if (!isAuthenticated) {
    return <LoginPage onLoggedIn={() => setIsAuthenticated(true)} />;
  }

  return (
    <BrowserRouter>
      <nav>
        <Link to="/">Train</Link>
        <Link to="/puzzles">Puzzles</Link>
      </nav>
      <Routes>
        <Route path="/" element={<TrainingPage />} />
        <Route path="/puzzles" element={<PuzzleListPage />} />
        <Route path="/puzzles/new" element={<PuzzleEditorPage />} />
        <Route path="/puzzles/:id/edit" element={<PuzzleEditorPage />} />
      </Routes>
    </BrowserRouter>
  );
}
