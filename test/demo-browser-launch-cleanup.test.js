import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ servers: [], launch: vi.fn() }));
vi.mock('puppeteer-core', () => ({ default: { launch: fixture.launch } }));
vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, createServer: (...args) => {
    const server = actual.default.createServer(...args); fixture.servers.push(server); return server;
  } } };
});
import { launch } from '../scripts/lib/demo-browser.mjs';

beforeEach(() => { vi.stubEnv('CHROME_PATH', 'test-only-browser-path'); fixture.launch.mockReset(); });
afterEach(async () => {
  // Tests use real owned HTTP listeners and a mocked launcher: no Chrome runs.
  // Always clean up even the intentionally failing first implementation.
  await Promise.all(fixture.servers.splice(0).map((server) => new Promise((resolve) => server.close(() => resolve()))));
  vi.unstubAllEnvs();
});

describe('browser bench launcher owns its HTTP server on every startup outcome', () => {
  it('closes the real listening server before returning a rejected Chrome launch', async () => {
    const failure = new Error('Simulated Chrome initial-page launch timeout');
    let server, closed = false;
    fixture.launch.mockImplementation(async () => {
      server = fixture.servers.at(-1); expect(server.listening).toBe(true);
      server.once('close', () => { closed = true; }); throw failure;
    });
    await expect(launch()).rejects.toBe(failure);
    expect(server.listening).toBe(false); expect(closed).toBe(true);
  });
  it('also releases the server when launcher validation throws synchronously', async () => {
    const failure = new TypeError('Simulated invalid executable path');
    fixture.launch.mockImplementation(() => { throw failure; });
    await expect(launch()).rejects.toBe(failure);
    expect(fixture.servers).toHaveLength(1); expect(fixture.servers[0].listening).toBe(false);
  });
  it('keeps the existing launch settings and normal browser/server close path', async () => {
    const browser = { close: vi.fn(async () => undefined) }; fixture.launch.mockResolvedValue(browser);
    const transport = await launch(); expect(transport.browser).toBe(browser);
    expect(new URL(transport.base).hostname).toBe('localhost'); expect(fixture.servers[0].listening).toBe(true);
    expect(fixture.launch).toHaveBeenCalledExactlyOnceWith({ executablePath: 'test-only-browser-path', headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    await transport.close(); expect(browser.close).toHaveBeenCalledOnce(); expect(fixture.servers[0].listening).toBe(false);
  });
});
