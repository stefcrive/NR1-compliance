import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export async function hashPassword(plainPassword: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(plainPassword, salt, 64)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  plainPassword: string,
  storedHash: string,
): Promise<boolean> {
  const separatorIndex = storedHash.indexOf(":");
  if (separatorIndex < 1) {
    return false;
  }

  const saltHex = storedHash.slice(0, separatorIndex);
  const hashHex = storedHash.slice(separatorIndex + 1);

  if (!saltHex || !hashHex) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const candidate = (await scryptAsync(plainPassword, salt, expected.length)) as Buffer;

  if (candidate.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(candidate, expected);
}
