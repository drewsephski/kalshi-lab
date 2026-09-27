import { readFileSync } from "node:fs";
import { createPrivateKey, type KeyObject } from "node:crypto";
import { KalshiConfigError } from "./errors.ts";
import type { KalshiConfig } from "./types.ts";

export function parseKalshiConfig(env: NodeJS.ProcessEnv): KalshiConfig {
  if (env.KALSHI_ENV !== "demo") {
    throw new KalshiConfigError(
      'KALSHI_ENV must be set to exactly "demo". This client has no production mode.',
    );
  }

  const apiKeyId = env.KALSHI_API_KEY_ID?.trim();
  const privateKeyPath = env.KALSHI_PRIVATE_KEY_PATH?.trim();

  if (!apiKeyId) {
    throw new KalshiConfigError("KALSHI_API_KEY_ID is required.");
  }
  if (!privateKeyPath) {
    throw new KalshiConfigError("KALSHI_PRIVATE_KEY_PATH is required.");
  }

  return { environment: "demo", apiKeyId, privateKeyPath };
}

export function loadKalshiPrivateKey(privateKeyPath: string): KeyObject {
  let key: KeyObject;
  try {
    const pem = readFileSync(privateKeyPath, "utf8");
    key = createPrivateKey(pem);
  } catch {
    throw new KalshiConfigError(
      `Could not load a valid unencrypted private key from ${privateKeyPath}. Check the path and PEM format.`,
    );
  }

  if (key.asymmetricKeyType !== "ed25519" && key.asymmetricKeyType !== "rsa") {
    throw new KalshiConfigError(
      `Unsupported private key type "${key.asymmetricKeyType ?? "unknown"}". Kalshi keys must be Ed25519 or RSA.`,
    );
  }

  return key;
}
