import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpError } from "../../errors/HttpError.js";

/** The encryption key stays outside the database and agent processes. */
export class SecretCipher {
  constructor(private readonly encodedKey: string | undefined) {}

  encrypt(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64")).join(".");
  }

  decrypt(value: string): string {
    const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64"));
    const cipher = createDecipheriv("aes-256-gcm", this.key(), iv!);
    cipher.setAuthTag(tag!);
    return Buffer.concat([cipher.update(encrypted!), cipher.final()]).toString("utf8");
  }

  private key(): Buffer {
    const key = Buffer.from(this.encodedKey ?? "", "base64");
    if (key.length !== 32)
      throw new HttpError(
        503,
        "CREDENTIAL_STORAGE_UNAVAILABLE",
        "Set KUSHEX_CREDENTIAL_ENCRYPTION_KEY to a base64-encoded 32-byte key on the server before saving API keys.",
      );
    return key;
  }
}
