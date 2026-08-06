import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import oauthController from './oauth.controller.js';

import type { Request, Response } from 'express';

describe('OAuthController.oauthCallback', () => {
    it('renders a trusted local completion page for a provider callback without state', async () => {
        const req = {
            query: { installation_id: 'install-1', setup_action: 'install' },
            headers: { referer: 'https://attacker.example/redirect' },
            get: vi.fn().mockReturnValue('https://attacker.example/redirect')
        } as unknown as Request;
        const res = { redirect: vi.fn(), status: vi.fn(), set: vi.fn(), send: vi.fn() } as unknown as Response;

        await oauthController.oauthCallback(req, res, vi.fn());

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalled();
        expect(res.redirect).not.toHaveBeenCalled();
    });

    it('never includes a callback installation identifier in the existing-installation log', async () => {
        const source = await readFile(new URL('./oauth.controller.ts', import.meta.url), 'utf8');
        const start = source.indexOf("logCtx.info('Existing installation found, skipping token exchange'");
        const end = source.indexOf('});', start);
        const logCall = source.slice(start, end);

        expect(start).toBeGreaterThan(-1);
        expect(logCall).toContain('hasInstallationId: true');
        expect(logCall).not.toContain('installationId');
    });
});
