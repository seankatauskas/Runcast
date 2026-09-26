/** Deterministic JSON for content identities shared by Node, browsers, and Hermes. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();

  function encode(current: unknown, inArray: boolean): string | undefined {
    if (current === null) return 'null';
    if (typeof current === 'string' || typeof current === 'boolean') {
      return JSON.stringify(current);
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current))
        throw new TypeError('Canonical JSON rejects non-finite numbers');
      return Object.is(current, -0) ? '0' : JSON.stringify(current);
    }
    if (typeof current === 'bigint') throw new TypeError('Canonical JSON rejects bigint');
    if (
      typeof current === 'undefined' ||
      typeof current === 'function' ||
      typeof current === 'symbol'
    ) {
      return inArray ? 'null' : undefined;
    }
    if (typeof current !== 'object') return undefined;
    if (ancestors.has(current)) throw new TypeError('Canonical JSON rejects cyclic values');
    if (typeof (current as { toJSON?: unknown }).toJSON === 'function') {
      return encode((current as { toJSON(): unknown }).toJSON(), inArray);
    }
    ancestors.add(current);
    let result: string;
    if (Array.isArray(current)) {
      result = `[${current.map((item) => encode(item, true) ?? 'null').join(',')}]`;
    } else {
      const object = current as Record<string, unknown>;
      const pairs = Object.keys(object)
        .sort()
        .flatMap((key) => {
          const encoded = encode(object[key], false);
          return encoded === undefined ? [] : [`${JSON.stringify(key)}:${encoded}`];
        });
      result = `{${pairs.join(',')}}`;
    }
    ancestors.delete(current);
    return result;
  }

  const encoded = encode(value, false);
  if (encoded === undefined) throw new TypeError('Value has no JSON representation');
  return encoded;
}

const SHA256_INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  view.setUint32(paddedLength - 8, high, false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = new Uint32Array(SHA256_INITIAL);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15];
      const b = words[i - 2];
      const s0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
      const s1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choose + SHA256_K[i] + words[i]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('');
}

export function contentIdentity(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Identity of the route geometry only. It deliberately excludes mutable names,
 * local/server IDs, derived distances, and parser diagnostics so the exact
 * same ordered GPX points deduplicate across imports and devices.
 */
export function routeGeometryIdentity(route: {
  part: { points: Array<{ lat: number; lon: number; elevationM: number | null }> };
}): string {
  return contentIdentity(
    route.part.points.map(({ lat, lon, elevationM }) => [lat, lon, elevationM]),
  );
}
