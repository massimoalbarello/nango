import { AxiosError } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { getTestConnection } from '../../seeders/connection.seeder.js';
import { ProxyRequest } from './request.js';
import { getDefaultProxy } from './utils.test.js';

import type { InternalAxiosRequestConfig } from 'axios';

function makeAxiosError(status: number): AxiosError {
    const err = new AxiosError(`Request failed with status code ${status}`);
    err.response = {
        status,
        data: {},
        headers: {},
        statusText: String(status),
        config: {} as InternalAxiosRequestConfig
    };
    return err;
}

describe('call', () => {
    it('should make a single successful http call', async () => {
        const fn = vi.fn();
        const proxy = new ProxyRequest({
            logger: fn,
            proxyConfig: getDefaultProxy({ provider: { proxy: { base_url: 'https://httpstatuses.maor.io' } }, endpoint: '/200' }),
            getConnection: () => getTestConnection(),
            getIntegrationConfig: () => ({ oauth_client_id: null, oauth_client_secret: null })
        });
        vi.spyOn(proxy, 'httpCall').mockResolvedValue({
            status: 200,
            data: {},
            headers: {},
            config: {} as InternalAxiosRequestConfig,
            statusText: 'OK'
        });
        const res = (await proxy.request()).unwrap();
        expect(res).toMatchObject({ status: 200 });
        expect(fn).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                level: 'info',
                type: 'http',
                message: 'GET https://httpstatuses.maor.io/200',
                request: { headers: {}, method: 'GET', url: 'https://httpstatuses.maor.io/200' },
                response: expect.objectContaining({ code: 200 })
            })
        );
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should make a single failed http call', async () => {
        const fn = vi.fn();
        const proxy = new ProxyRequest({
            logger: fn,
            proxyConfig: getDefaultProxy({ provider: { proxy: { base_url: 'https://httpstatuses.maor.io' } }, endpoint: '/400', retries: 1 }),
            getConnection: () => getTestConnection(),
            getIntegrationConfig: () => ({ oauth_client_id: null, oauth_client_secret: null })
        });
        vi.spyOn(proxy, 'httpCall').mockRejectedValue(makeAxiosError(400));
        await expect(async () => (await proxy.request()).unwrap()).rejects.toThrowError();
        expect(fn).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                level: 'error',
                type: 'http',
                message: 'GET https://httpstatuses.maor.io/400',
                request: { headers: {}, method: 'GET', url: 'https://httpstatuses.maor.io/400' },
                response: expect.objectContaining({ code: 400 }),
                retry: { max: 1, attempt: 0, waited: 0 }
            })
        );
        expect(fn).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                level: 'warn',
                message: 'Skipping retry HTTP call (reason: not_retryable) [1/1]'
            })
        );
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('logs only proxy query parameter names on success', async () => {
        const fn = vi.fn();
        const proxy = new ProxyRequest({
            logger: fn,
            proxyConfig: getDefaultProxy({
                provider: { proxy: { base_url: 'https://api.example.com', headers: { 'x-api-key': 'success-header-secret-must-not-persist' } } },
                endpoint: '/records?cursor=success-secret-must-not-persist&filter=private-value'
            }),
            getConnection: () => getTestConnection(),
            getIntegrationConfig: () => ({ oauth_client_id: null, oauth_client_secret: null })
        });
        vi.spyOn(proxy, 'httpCall').mockResolvedValue({
            status: 200,
            data: {},
            headers: {},
            config: {} as InternalAxiosRequestConfig,
            statusText: 'OK'
        });

        await proxy.request();

        const persisted = JSON.stringify(fn.mock.calls);
        expect(persisted).not.toContain('success-secret-must-not-persist');
        expect(persisted).not.toContain('success-header-secret-must-not-persist');
        expect(persisted).not.toContain('private-value');
        expect(fn).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'GET https://api.example.com/records?cursor&filter',
                request: expect.objectContaining({
                    url: 'https://api.example.com/records?cursor&filter',
                    headers: expect.objectContaining({ 'x-api-key': '<redacted>' })
                })
            })
        );
    });

    it('logs only proxy query parameter names on Axios errors', async () => {
        const fn = vi.fn();
        const proxy = new ProxyRequest({
            logger: fn,
            proxyConfig: getDefaultProxy({
                provider: { proxy: { base_url: 'https://api.example.com', headers: { 'x-api-key': 'error-header-secret-must-not-persist' } } },
                endpoint: '/records?cursor=error-secret-must-not-persist&filter=private-value',
                retries: 0
            }),
            getConnection: () => getTestConnection(),
            getIntegrationConfig: () => ({ oauth_client_id: null, oauth_client_secret: null })
        });
        const error = makeAxiosError(400);
        error.message = 'Request failed with error-secret-must-not-persist';
        vi.spyOn(proxy, 'httpCall').mockRejectedValue(error);

        await proxy.request();

        const persisted = JSON.stringify(fn.mock.calls);
        expect(persisted).not.toContain('error-secret-must-not-persist');
        expect(persisted).not.toContain('error-header-secret-must-not-persist');
        expect(persisted).not.toContain('private-value');
        expect(fn).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'GET https://api.example.com/records?cursor&filter',
                request: expect.objectContaining({
                    url: 'https://api.example.com/records?cursor&filter',
                    headers: expect.objectContaining({ 'x-api-key': '<redacted>' })
                }),
                error: expect.objectContaining({ message: 'Proxy request failed' })
            })
        );
    });

    it('should retries failed http call', { timeout: 10000 }, async () => {
        const fn = vi.fn();
        const getConnection = vi.fn(() => {
            return getTestConnection();
        });
        const proxy = new ProxyRequest({
            logger: fn,
            proxyConfig: getDefaultProxy({ provider: { proxy: { base_url: 'https://httpstatuses.maor.io' } }, endpoint: '/500', retries: 1 }),
            getConnection,
            getIntegrationConfig: () => ({ oauth_client_id: null, oauth_client_secret: null })
        });
        vi.spyOn(proxy, 'httpCall').mockRejectedValue(makeAxiosError(500));
        await expect(async () => (await proxy.request()).unwrap()).rejects.toThrowError();
        expect(fn).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                level: 'error',
                type: 'http',
                message: 'GET https://httpstatuses.maor.io/500',
                request: { headers: {}, method: 'GET', url: 'https://httpstatuses.maor.io/500' },
                response: expect.objectContaining({ code: 500 }),
                retry: { max: 1, attempt: 0, waited: 0 }
            })
        );
        expect(fn).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                level: 'warn',
                message: 'Retrying HTTP call (reason: status_code_500). Waiting for 3000ms [1/1]'
            })
        );
        expect(fn).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({
                level: 'error',
                type: 'http',
                message: 'GET https://httpstatuses.maor.io/500',
                request: { headers: {}, method: 'GET', url: 'https://httpstatuses.maor.io/500' },
                response: expect.objectContaining({ code: 500 }),
                retry: { max: 1, attempt: 1, waited: 3000 }
            })
        );
        expect(fn).toHaveBeenCalledTimes(3);

        // should dynamically rebuild proxy config on each iteration
        expect(getConnection).toHaveBeenCalledTimes(2);
    });
});
