import type {
  CommitImportResponse,
  CreatePuzzleRequest,
  CreatePuzzleResponse,
  ExportPuzzlesQuery,
  ImportBatchResponse,
  ImportKindValue,
  ListPuzzlesResponse,
  LoginRequest,
  LoginResponse,
  PgnImportModeValue,
  PuzzleDetail,
  TrainingAttemptRequest,
  TrainingAttemptResponse,
  TrainingHintRequest,
  TrainingHintResponse,
  TrainingNextResponse,
  TrainingReviewRequest,
  TrainingReviewResponse,
  TrainingSkipRequest,
  TrainingSkipResponse,
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
  // A FormData body must keep the browser-generated multipart Content-Type, boundary and all.
  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
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

export function trainingHint(body: TrainingHintRequest): Promise<TrainingHintResponse | null> {
  return request<TrainingHintResponse>("/training/hint", { method: "POST", body: JSON.stringify(body) });
}

export function trainingSkip(body: TrainingSkipRequest): Promise<TrainingSkipResponse | null> {
  return request<TrainingSkipResponse>("/training/skip", { method: "POST", body: JSON.stringify(body) });
}

export function trainingReview(body: TrainingReviewRequest): Promise<TrainingReviewResponse | null> {
  return request<TrainingReviewResponse>("/training/review", { method: "POST", body: JSON.stringify(body) });
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

export interface ImportUpload {
  file: File;
  kind: ImportKindValue;
  mode?: PgnImportModeValue;
  plies?: number[];
}

/** The caller owns the Idempotency-Key so that retrying a failed upload replays rather than
 * re-imports (plan §3.5). */
export function previewImport(upload: ImportUpload, idempotencyKey: string): Promise<ImportBatchResponse | null> {
  const form = new FormData();
  form.append("file", upload.file);
  form.append("kind", upload.kind);
  if (upload.mode) {
    form.append("mode", upload.mode);
  }
  if (upload.plies && upload.plies.length > 0) {
    form.append("plies", upload.plies.join(","));
  }

  return request<ImportBatchResponse>("/imports", {
    method: "POST",
    body: form,
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function commitImport(batchId: string, skipIndices: number[]): Promise<CommitImportResponse | null> {
  return request<CommitImportResponse>(`/imports/${batchId}/commit`, {
    method: "POST",
    body: JSON.stringify(skipIndices.length > 0 ? { skipIndices } : {}),
  });
}

/** Downloads through `fetch` rather than a plain link so the Authorization header is sent. */
export async function downloadExport(query: ExportPuzzlesQuery): Promise<void> {
  const params = new URLSearchParams({
    format: query.format,
    includeCards: String(query.includeCards),
    includeReviews: String(query.includeReviews),
  });

  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/puzzles/export?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new ApiError(response.status, "Export failed");
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `puzzles.${query.format}`;
  link.click();
  URL.revokeObjectURL(url);
}
