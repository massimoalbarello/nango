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
});
