import type { ReaderImageDecoder, ReaderImageDimensions, ReaderImageResource } from '../../contracts';

export const encodedImageDimensionDecoder: ReaderImageDecoder = {
  async decode(resource) {
    return readEncodedImageDimensions(resource);
  },
  dispose() {},
};

export function readEncodedImageDimensions(resource: ReaderImageResource): ReaderImageDimensions {
  const { bytes, href } = resource;
  const dimensions =
    readPngDimensions(bytes) ??
    readJpegDimensions(bytes) ??
    readGifDimensions(bytes) ??
    readWebpDimensions(bytes) ??
    readSvgDimensions(bytes);

  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error(`Unsupported or invalid image dimensions for ${href}.`);
  }
  return dimensions;
}

function readPngDimensions(bytes: Uint8Array): ReaderImageDimensions | undefined {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    return undefined;
  }
  return {
    width: readUint32BigEndian(bytes, 16),
    height: readUint32BigEndian(bytes, 20),
  };
}

function readGifDimensions(bytes: Uint8Array): ReaderImageDimensions | undefined {
  if (bytes.length < 10 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) {
    return undefined;
  }
  return {
    width: readUint16LittleEndian(bytes, 6),
    height: readUint16LittleEndian(bytes, 8),
  };
}

function readJpegDimensions(bytes: Uint8Array): ReaderImageDimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;
  while (offset + 8 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) {
      offset += 1;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) {
      return undefined;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    const segmentLength = readUint16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return undefined;
    }
    if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
      return {
        height: readUint16BigEndian(bytes, offset + 3),
        width: readUint16BigEndian(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }
  return undefined;
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function readWebpDimensions(bytes: Uint8Array): ReaderImageDimensions | undefined {
  if (bytes.length < 30 || readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WEBP') {
    return undefined;
  }

  const chunk = readAscii(bytes, 12, 4);
  if (chunk === 'VP8X') {
    return {
      width: 1 + readUint24LittleEndian(bytes, 24),
      height: 1 + readUint24LittleEndian(bytes, 27),
    };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    return {
      width: 1 + (bytes[21]! | ((bytes[22]! & 0x3f) << 8)),
      height: 1 + ((bytes[22]! >> 6) | (bytes[23]! << 2) | ((bytes[24]! & 0x0f) << 10)),
    };
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: readUint16LittleEndian(bytes, 26) & 0x3fff,
      height: readUint16LittleEndian(bytes, 28) & 0x3fff,
    };
  }
  return undefined;
}

function readSvgDimensions(bytes: Uint8Array): ReaderImageDimensions | undefined {
  if (bytes.length === 0) {
    return undefined;
  }
  const source = readAscii(bytes, 0, Math.min(bytes.length, 16_384));
  const svgStart = source.match(/<svg\b[^>]*>/i)?.[0];
  if (!svgStart) {
    return undefined;
  }

  const width = readSvgLength(svgStart, 'width');
  const height = readSvgLength(svgStart, 'height');
  if (width && height) {
    return { width, height };
  }

  const viewBox = svgStart.match(
    /\bviewBox\s*=\s*["']\s*[-+\d.e]+[\s,]+[-+\d.e]+[\s,]+([-+\d.e]+)[\s,]+([-+\d.e]+)\s*["']/i,
  );
  if (!viewBox) {
    return undefined;
  }
  return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
}

function readSvgLength(source: string, attribute: string): number | undefined {
  const match = source.match(new RegExp(`\\b${attribute}\\s*=\\s*["']\\s*([+\\d.e-]+)\\s*([a-z%]*)`, 'i'));
  if (!match) {
    return undefined;
  }
  const unit = match[2]?.toLocaleLowerCase();
  if (unit && unit !== 'px') {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x1000000 + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
}
