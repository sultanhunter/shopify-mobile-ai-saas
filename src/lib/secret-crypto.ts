import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const SECRET_PREFIX = "enc.v1";

function getEncryptionSecret(): string {
  const secret =
    process.env.SHOPIFY_TOKEN_ENCRYPTION_SECRET ??
    process.env.APP_ENCRYPTION_SECRET ??
    process.env.SHOPIFY_API_SECRET;

  if (!secret) {
    throw new Error(
      "Missing encryption secret. Set SHOPIFY_TOKEN_ENCRYPTION_SECRET (preferred) or APP_ENCRYPTION_SECRET."
    );
  }

  return secret;
}

function createEncryptionKey(): Buffer {
  return createHash("sha256").update(getEncryptionSecret()).digest();
}

export function encryptSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Cannot encrypt an empty secret");
  }

  const iv = randomBytes(12);
  const key = createEncryptionKey();
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    SECRET_PREFIX,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

export function decryptSecret(value: string): string {
  if (!value.startsWith(`${SECRET_PREFIX}:`)) {
    return value;
  }

  const parts = value.split(":");
  if (parts.length !== 4) {
    throw new Error("Encrypted secret has an invalid format");
  }

  const [, ivRaw, authTagRaw, encryptedRaw] = parts;
  const key = createEncryptionKey();

  const iv = Buffer.from(ivRaw, "base64url");
  const authTag = Buffer.from(authTagRaw, "base64url");
  const encrypted = Buffer.from(encryptedRaw, "base64url");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
