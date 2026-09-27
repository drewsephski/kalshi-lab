import { setTimeout } from "node:timers/promises";

export async function retry<T>(
  operation: () => Promise<T>,
  attempts = 3,
  wait: (ms: number) => Promise<unknown> = (ms) => setTimeout(ms),
): Promise<T> {
  let failure: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      failure = error;
    }
    if (attempt + 1 < attempts) await wait(Math.min(4000, 1000 * 2 ** attempt));
  }
  throw failure;
}

/** Never emit arbitrary driver error messages, connection strings, or API bodies. */
export function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "cause" in error &&
    error.cause &&
    error.cause !== error
  )
    return errorCode(error.cause);
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status) &&
    error.status >= 100 &&
    error.status <= 599
  )
    return `HTTP_${error.status}`;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Za-z0-9_]{1,40}$/.test(error.code)
  )
    return error.code;
  return error instanceof Error ? error.name : "UnknownError";
}
