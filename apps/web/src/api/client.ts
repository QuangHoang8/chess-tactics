import type {
  LoginRequest,
  LoginResponse,
  TrainingAttemptRequest,
  TrainingAttemptResponse,
  TrainingNextResponse,
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

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
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
    };
    throw new ApiError(response.status, body.message ?? "Request failed");
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
