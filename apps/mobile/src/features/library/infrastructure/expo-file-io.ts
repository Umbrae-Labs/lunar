import { FileMode, type File } from 'expo-file-system';

const WRITE_CHUNK_BYTES = 512 * 1024;
const ASYNC_YIELD_INTERVAL_BYTES = 2 * 1024 * 1024;

// Standard FIPS 180-4 SHA-256 initial hash values and round constants.
const SHA256_INIT = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

/**
 * Releases an Expo SharedObject (such as `File`, `Directory`, or `FileHandle`)
 * immediately so native handles do not wait for JVM/Hermes finalization.
 */
export function releaseSharedObject(object: unknown): void {
  if (!object || typeof object !== 'object') return;
  const release = (object as { release?: unknown }).release;
  if (typeof release !== 'function') return;
  try {
    release.call(object);
  } catch {
    // Shared objects may already be released or mocked in unit tests.
  }
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Writes binary data through `FileHandle.writeBytes` in bounded chunks.
 *
 * On Android, `File.write(Uint8Array)` converts the buffer through `TypedArrayFrontendConverter`,
 * which wraps the JS `Uint8Array` in a `JavaScriptTypedArray` holding a strong C++ `jsi::Object`
 * reference until ART GC collects the tiny Kotlin wrapper. `FileHandle.writeBytes` uses
 * `ByteArrayFrontendConverter` instead, copying each bounded chunk with zero JSI root retention.
 */
export function writeFileBytes(file: File, bytes: Uint8Array): void {
  file.create({ intermediates: true, overwrite: true });
  if (bytes.byteLength === 0) return;

  const handle = file.open(FileMode.Truncate);
  try {
    for (let offset = 0; offset < bytes.byteLength; offset += WRITE_CHUNK_BYTES) {
      const end = Math.min(offset + WRITE_CHUNK_BYTES, bytes.byteLength);
      handle.writeBytes(offset === 0 && end === bytes.byteLength ? bytes : bytes.subarray(offset, end));
    }
  } finally {
    try {
      handle.close();
    } catch {
      // Best-effort handle close.
    }
    releaseSharedObject(handle);
  }
}

/**
 * Pure-JS incremental SHA-256 (FIPS 180-4).
 *
 * Avoids `expo-crypto`'s `digest(SHA256, Uint8Array)` on Android, which passes the input
 * through `TypedArrayFrontendConverter` and pins large `Uint8Array`s in Hermes memory until
 * ART GC finalizes the Kotlin wrapper.
 */
export class Sha256 {
  private readonly state = new Uint32Array(SHA256_INIT);
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private blockLength = 0;
  private totalBytes = 0;
  private finished = false;

  update(data: Uint8Array): this {
    if (this.finished) {
      throw new Error('Cannot update a finalized Sha256 instance.');
    }
    const length = data.byteLength;
    if (length === 0) return this;
    this.totalBytes += length;

    let offset = 0;
    if (this.blockLength > 0) {
      const needed = 64 - this.blockLength;
      if (length < needed) {
        this.block.set(data, this.blockLength);
        this.blockLength += length;
        return this;
      }
      this.block.set(data.subarray(0, needed), this.blockLength);
      this.compress(this.block, 0);
      this.blockLength = 0;
      offset = needed;
    }

    while (offset + 64 <= length) {
      this.compress(data, offset);
      offset += 64;
    }

    if (offset < length) {
      const remaining = length - offset;
      this.block.set(data.subarray(offset), 0);
      this.blockLength = remaining;
    }

    return this;
  }

  digestHex(): string {
    if (!this.finished) {
      this.finished = true;
      const totalBits = this.totalBytes * 8;
      this.block[this.blockLength] = 0x80;
      this.blockLength += 1;

      if (this.blockLength > 56) {
        this.block.fill(0, this.blockLength, 64);
        this.compress(this.block, 0);
        this.blockLength = 0;
      }

      this.block.fill(0, this.blockLength, 56);
      const highBits = Math.floor(totalBits / 0x100000000);
      const lowBits = totalBits >>> 0;
      const view = new DataView(this.block.buffer, this.block.byteOffset, 64);
      view.setUint32(56, highBits, false);
      view.setUint32(60, lowBits, false);
      this.compress(this.block, 0);
      this.blockLength = 0;
    }

    let hex = '';
    for (let index = 0; index < 8; index += 1) {
      hex += this.state[index]!.toString(16).padStart(8, '0');
    }
    return hex;
  }

  private compress(buffer: Uint8Array, offset: number): void {
    const w = this.words;
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      w[index] =
        ((buffer[position]! << 24) |
          (buffer[position + 1]! << 16) |
          (buffer[position + 2]! << 8) |
          buffer[position + 3]!) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0Source = w[index - 15]!;
      const s1Source = w[index - 2]!;
      const s0 = ((s0Source >>> 7) | (s0Source << 25)) ^ ((s0Source >>> 18) | (s0Source << 14)) ^ (s0Source >>> 3);
      const s1 = ((s1Source >>> 17) | (s1Source << 15)) ^ ((s1Source >>> 19) | (s1Source << 13)) ^ (s1Source >>> 10);
      w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) >>> 0;
    }

    let a = this.state[0]!;
    let b = this.state[1]!;
    let c = this.state[2]!;
    let d = this.state[3]!;
    let e = this.state[4]!;
    let f = this.state[5]!;
    let g = this.state[6]!;
    let h = this.state[7]!;

    for (let index = 0; index < 64; index += 1) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[index]! + w[index]!) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.state[0] = (this.state[0]! + a) >>> 0;
    this.state[1] = (this.state[1]! + b) >>> 0;
    this.state[2] = (this.state[2]! + c) >>> 0;
    this.state[3] = (this.state[3]! + d) >>> 0;
    this.state[4] = (this.state[4]! + e) >>> 0;
    this.state[5] = (this.state[5]! + f) >>> 0;
    this.state[6] = (this.state[6]! + g) >>> 0;
    this.state[7] = (this.state[7]! + h) >>> 0;
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return new Sha256().update(bytes).digestHex();
}

export async function sha256HexAsync(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength <= ASYNC_YIELD_INTERVAL_BYTES) {
    return sha256Hex(bytes);
  }
  const hasher = new Sha256();
  for (let offset = 0; offset < bytes.byteLength; offset += ASYNC_YIELD_INTERVAL_BYTES) {
    const end = Math.min(offset + ASYNC_YIELD_INTERVAL_BYTES, bytes.byteLength);
    hasher.update(bytes.subarray(offset, end));
    if (end < bytes.byteLength) {
      await yieldToEventLoop();
    }
  }
  return hasher.digestHex();
}
