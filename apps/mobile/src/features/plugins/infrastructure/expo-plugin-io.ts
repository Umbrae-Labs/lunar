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

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Writes binary data via `FileHandle.writeBytes` in bounded chunks so Android's
 * `TypedArrayFrontendConverter` never pins JS `Uint8Array` buffers in C++ until ART GC.
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

export async function writeFileBytesAsync(file: File, bytes: Uint8Array): Promise<void> {
  file.create({ intermediates: true, overwrite: true });
  if (bytes.byteLength === 0) return;

  const handle = file.open(FileMode.Truncate);
  let sinceYield = 0;
  try {
    for (let offset = 0; offset < bytes.byteLength; offset += WRITE_CHUNK_BYTES) {
      const end = Math.min(offset + WRITE_CHUNK_BYTES, bytes.byteLength);
      handle.writeBytes(offset === 0 && end === bytes.byteLength ? bytes : bytes.subarray(offset, end));
      sinceYield += end - offset;
      if (end < bytes.byteLength && sinceYield >= ASYNC_YIELD_INTERVAL_BYTES) {
        sinceYield = 0;
        await yieldToEventLoop();
      }
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
 * Pure-JS SHA-256 hex digest that avoids pinning large `Uint8Array` buffers via
 * `expo-crypto`'s `TypedArray` JSI bridge on Android.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const state = new Uint32Array(SHA256_INIT);
  const block = new Uint8Array(64);
  const words = new Uint32Array(64);
  const length = bytes.byteLength;

  let offset = 0;
  let sinceYield = 0;
  while (offset + 64 <= length) {
    compressBlock(state, words, bytes, offset);
    offset += 64;
    sinceYield += 64;
    if (sinceYield >= ASYNC_YIELD_INTERVAL_BYTES && offset < length) {
      sinceYield = 0;
      await yieldToEventLoop();
    }
  }

  let blockLength = length - offset;
  if (blockLength > 0) {
    block.set(bytes.subarray(offset), 0);
  }

  const totalBits = length * 8;
  block[blockLength] = 0x80;
  blockLength += 1;

  if (blockLength > 56) {
    block.fill(0, blockLength, 64);
    compressBlock(state, words, block, 0);
    blockLength = 0;
  }

  block.fill(0, blockLength, 56);
  const view = new DataView(block.buffer, block.byteOffset, 64);
  view.setUint32(56, Math.floor(totalBits / 0x100000000), false);
  view.setUint32(60, totalBits >>> 0, false);
  compressBlock(state, words, block, 0);

  let hex = '';
  for (let index = 0; index < 8; index += 1) {
    hex += state[index]!.toString(16).padStart(8, '0');
  }
  return hex;
}

function compressBlock(state: Uint32Array, w: Uint32Array, buffer: Uint8Array, offset: number): void {
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

  let a = state[0]!;
  let b = state[1]!;
  let c = state[2]!;
  let d = state[3]!;
  let e = state[4]!;
  let f = state[5]!;
  let g = state[6]!;
  let h = state[7]!;

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

  state[0] = (state[0]! + a) >>> 0;
  state[1] = (state[1]! + b) >>> 0;
  state[2] = (state[2]! + c) >>> 0;
  state[3] = (state[3]! + d) >>> 0;
  state[4] = (state[4]! + e) >>> 0;
  state[5] = (state[5]! + f) >>> 0;
  state[6] = (state[6]! + g) >>> 0;
  state[7] = (state[7]! + h) >>> 0;
}
