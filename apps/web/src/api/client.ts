import type {
  CreatePuzzleRequest,
  CreatePuzzleResponse,
  ListPuzzlesResponse,
  LoginRequest,
  LoginResponse,
  PuzzleDetail,
  TrainingAttemptRequest,
  TrainingAttemptResponse,
  TrainingNextResponse,
  UpdatePuzzleRequest,
  UpdatePuzzleResponse,
} from "@chess-tactics/contracts";

const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api";
const TOKEN_STORAGE_KEY = "chess-tactics:accessToken";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export interface ApiErrorDetail {
  path: string;
  ply?: number;
  input?: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: ApiErrorDetail[],
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  const token = getStoredToken();
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (response.status === HTTP_NO_CONTENT) {
    return null;
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ message: response.statusText }))) as {
      message?: string;
      details?: ApiErrorDetail[];
    };
    throw new ApiError(response.status, body.message ?? "Request failed", body.details);
  }
  return (await response.json()) as T;
}

const HTTP_NO_CONTENT = 204;

export function login(body: LoginRequest): Promise<LoginResponse | null> {
  return request<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify(body) });
}

export function trainingNext(): Promise<TrainingNextResponse | null> {
  return request<TrainingNextResponse>("/training/next");
}

export function trainingAttempt(body: TrainingAttemptRequest): Promise<TrainingAttemptResponse | null> {
  return request<TrainingAttemptResponse>("/training/attempt", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listPuzzles(cursor?: string): Promise<ListPuzzlesResponse | null> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request<ListPuzzlesResponse>(`/puzzles${query}`);
}

export function getPuzzle(id: string): Promise<PuzzleDetail | null> {
  return request<PuzzleDetail>(`/puzzles/${id}`);
}

export function createPuzzle(body: CreatePuzzleRequest): Promise<CreatePuzzleResponse | null> {
  return request<CreatePuzzleResponse>("/puzzles", { method: "POST", body: JSON.stringify(body) });
}

export function updatePuzzle(id: string, body: UpdatePuzzleRequest): Promise<UpdatePuzzleResponse | null> {
  return request<UpdatePuzzleResponse>(`/puzzles/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deletePuzzle(id: string): Promise<null> {
  return request<null>(`/puzzles/${id}`, { method: "DELETE" });
}
