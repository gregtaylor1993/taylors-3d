import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { createSha256, sha256, SHA256_MAX_BYTES } from '../src/sha256.js';

const bytes = (value) => new TextEncoder().encode(value);
const nodeHash = (value) => createHash('sha256').update(value).digest('hex');
describe('bounded SHA256 LAN fallback', () => {
  // NIST worked examples: https://csrc.nist.gov/CSRC/media/Projects/Cryptographic-Standards-and-Guidelines/documents/examples/SHA256.pdf
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ])('matches known message %s using fallback and real WebCrypto', async (input, expected) => {
    const data = bytes(input);
    expect(createSha256().update(data).digest()).toBe(expected);
    expect(await sha256(data, { subtle: null })).toBe(expected);
    expect(await sha256(data, { subtle: webcrypto.subtle })).toBe(expected);
  });
  it.each([1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 4096, 65537])('matches real crypto across padding/block boundaries %s', async (length) => {
    const data = randomBytes(length), hash = createSha256();
    for (let index = 0; index < data.length; index += 13) hash.update(data.subarray(index, index + 13));
    expect(hash.digest()).toBe(nodeHash(data));
    expect(await sha256(data, { subtle: null })).toBe(await sha256(data, { subtle: webcrypto.subtle }));
  });
  it('matches the million-a standard result over many changing chunk sizes without changing input', () => {
    const data = bytes('a'.repeat(1_000_000)), hash = createSha256(), snapshot = data.slice();
    for (let offset = 0, count = 1; offset < data.length; count = count * 13 % 4096 + 1) {
      hash.update(data.subarray(offset, offset + count)); offset += count;
    }
    expect(hash.digest()).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
    // Compare every byte natively without walking a million matcher properties.
    expect(Buffer.from(data).equals(Buffer.from(snapshot))).toBe(true);
  });
  it('handles subarray offsets, empty chunks and independent instances', () => {
    const source = bytes('ignoreabcignore'), a = createSha256(), b = createSha256();
    a.update(source.subarray(6, 9)); a.update(new Uint8Array());
    expect(a.digest()).toBe(nodeHash(bytes('abc')));
    expect(b.digest()).toBe(nodeHash(new Uint8Array()));
    expect(() => a.update(bytes('more'))).toThrow(); expect(() => a.digest()).toThrow();
  });
  // This boundary proof deliberately hashes the full64MiB allowed budget in
  // JavaScript. Its CPU time is separate from the ordinary five-second tests.
  it('rejects unsupported input and byte budget before accepting oversized data', async () => {
    for (const data of ['', [], new ArrayBuffer(5), null, new Uint8Array(SHA256_MAX_BYTES + 1)]) {
      expect(() => createSha256().update(data)).toThrow(); await expect(sha256(data)).rejects.toThrow();
    }
    const hash = createSha256(), chunk = new Uint8Array(1024 * 1024);
    for (let i = 0; i < 64; i++) hash.update(chunk);
    expect(() => hash.update(new Uint8Array(1))).toThrow();
    expect(hash.digest()).toBe(nodeHash(new Uint8Array(SHA256_MAX_BYTES)));
  }, 30000);
  it('uses a real WebCrypto method when available, and verified fallback if access is forbidden', async () => {
    let called = 0;
    const data = bytes('abc'), actual = webcrypto.subtle;
    expect(await sha256(data, { subtle: { digest(...args) { called++; return actual.digest(...args); } } })).toBe(nodeHash(data));
    expect(called).toBe(1);
    expect(await sha256(data, { subtle: { digest() { throw new Error('Context denied'); } } })).toBe(nodeHash(data));
  });
});
