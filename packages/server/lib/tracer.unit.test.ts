import { beforeEach, describe, expect, it, vi } from 'vitest';

const tracerMocks = vi.hoisted(() => ({
    init: vi.fn(),
    use: vi.fn()
}));

vi.mock('dd-trace', () => ({
    default: tracerMocks
}));

describe('tracing URL privacy', () => {
    beforeEach(() => {
        vi.resetModules();
        tracerMocks.init.mockClear();
        tracerMocks.use.mockClear();
    });

    it('strips every query value from automatic HTTP and Express span tags', async () => {
        await import('./tracer.js');

        const expressConfig = tracerMocks.use.mock.calls.find(([plugin]) => plugin === 'express')?.[1];
        const httpConfig = tracerMocks.use.mock.calls.find(([plugin]) => plugin === 'http')?.[1];
        const span = { setTag: vi.fn() };

        expect(expressConfig?.queryStringObfuscation).toBe(true);
        expect(httpConfig?.queryStringObfuscation).toBe(true);

        for (const config of [httpConfig, expressConfig]) {
            config?.hooks.request(span, {
                originalUrl: '/oauth/callback?code=authorization-code&state=oauth-state',
                url: '/oauth/callback?code=authorization-code&state=oauth-state'
            });
        }

        expect(span.setTag).toHaveBeenCalledTimes(2);
        expect(span.setTag).toHaveBeenNthCalledWith(1, 'http.url', '/oauth/callback');
        expect(span.setTag).toHaveBeenNthCalledWith(2, 'http.url', '/oauth/callback');
        expect(JSON.stringify(span.setTag.mock.calls)).not.toContain('authorization-code');
        expect(JSON.stringify(span.setTag.mock.calls)).not.toContain('oauth-state');
    });
});
