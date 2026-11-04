import type { ApiErrorBody } from "@/types/api";

export const API_BASE: string = import.meta.env.VITE_API_URL ?? "/api/v1";
const CSRF_COOKIE = "docmind_csrf";
const CSRF_HEADER = "X-CSRF-Token";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const parts = document.cookie ? document.cookie.split("; ") : [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    const key = eq === -1 ? part : part.slice(0, eq);
    if (key === name) return decodeURIComponent(eq === -1 ? "" : part.slice(eq + 1));
  }
  return null;
}

let csrfPromise: Promise<string | null> | null = null;

async function ensureCsrfToken(): Promise<string | null> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  if (!csrfPromise) {
    csrfPromise = fetch(`${API_BASE}/auth/csrf`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json().catch(() => null)) as { csrf_token?: string } | null;
        return readCookie(CSRF_COOKIE) ?? body?.csrf_token ?? null;
      })
      .catch(() => null)
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
}

const DEFAULT_MESSAGES: Record<number, string> = {
  400: "Requisição inválida.",
  401: "Sua sessão expirou. Faça login novamente.",
  403: "Você não tem permissão para esta ação.",
  404: "Recurso não encontrado.",
  409: "Conflito ao processar a requisição.",
  413: "Arquivo muito grande.",
  415: "Formato de arquivo não suportado.",
  422: "Dados inválidos.",
  429: "Limite de uso atingido. Tente novamente em instantes.",
  500: "Erro interno do servidor.",
  502: "Servidor indisponível.",
  503: "Serviço temporariamente indisponível.",
};

async function toApiError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const err = body?.error;
  return new ApiError(
    res.status,
    err?.code ?? `http_${res.status}`,
    err?.message ?? DEFAULT_MESSAGES[res.status] ?? "Erro inesperado.",
    err?.details,
  );
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Quando `body` é um FormData, o Content-Type é omitido para o navegador definir o boundary. */
  signal?: AbortSignal;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export function buildQuery(query?: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export async function apiFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  let body: BodyInit | undefined;

  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  if (MUTATING.has(method)) {
    const token = await ensureCsrfToken();
    if (token) headers[CSRF_HEADER] = token;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${buildQuery(options.query)}`, {
      method,
      headers,
      body,
      credentials: "include",
      signal: options.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "network_error", "Não foi possível conectar ao servidor.");
  }

  if (!res.ok) throw await toApiError(res);
  return res;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await apiFetch(path, options);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const http = {
  get: <T>(path: string, query?: RequestOptions["query"], signal?: AbortSignal) =>
    api<T>(path, { method: "GET", query, signal }),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) => api<T>(path, { method: "POST", body, signal }),
  patch: <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body }),
  delete: <T = void>(path: string) => api<T>(path, { method: "DELETE" }),
};

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function errorMessage(e: unknown, fallback = "Algo deu errado."): string {
  if (isApiError(e)) return e.message;
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}
