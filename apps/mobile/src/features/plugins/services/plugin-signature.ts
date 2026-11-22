import { ed25519 } from '@noble/curves/ed25519.js';
import type { VerifyEd25519 } from '@umbrae-labs/lunar-plugin-sdk/package-format';

/**
 * Pure Ed25519 verification with the strict RFC 8032 rules (`zip215: false`), the same
 * acceptance rules as OpenSSL and Node.js, which sign packages in the plugin CLI.
 */
export const verifyEd25519: VerifyEd25519 = (signature, message, publicKey) =>
  ed25519.verify(signature, message, publicKey, { zip215: false });
