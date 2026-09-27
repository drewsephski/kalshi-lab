import {
  constants,
  createSign,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";

export function buildPresignText(
  timestampMs: string | number,
  method: string,
  requestPath: string,
): string {
  const pathWithoutQuery = requestPath.split("?", 1)[0];
  return `${timestampMs}${method.toUpperCase()}${pathWithoutQuery}`;
}

export function signRequest(
  privateKey: KeyObject,
  timestampMs: string,
  method: string,
  requestPath: string,
): string {
  const message = Buffer.from(
    buildPresignText(timestampMs, method, requestPath),
    "utf8",
  );

  if (privateKey.asymmetricKeyType === "ed25519") {
    return cryptoSign(null, message, privateKey).toString("base64");
  }

  if (privateKey.asymmetricKeyType === "rsa") {
    const signer = createSign("RSA-SHA256");
    signer.update(message);
    signer.end();
    return signer
      .sign({
        key: privateKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
      })
      .toString("base64");
  }

  throw new Error("Unsupported Kalshi signing key type.");
}
