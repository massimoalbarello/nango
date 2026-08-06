import { describe, expect, it } from 'vitest';

import { errorName, headerNamesOnly, sensitiveFields, stripUrlQuery, urlWithQueryParameterNames } from './logging.js';

describe('privacy-safe logging helpers', () => {
    it('retains structure without secret values', () => {
        const fields = sensitiveFields({ access_token: 'access-secret', refresh_token: 'refresh-secret' });

        expect(fields).toEqual({ present: true, fieldNames: ['access_token', 'refresh_token'] });
        expect(JSON.stringify(fields)).not.toContain('access-secret');
        expect(JSON.stringify(fields)).not.toContain('refresh-secret');
        expect(errorName(new TypeError('access-secret'))).toBe('TypeError');
    });

    it('removes all URL query and fragment values', () => {
        expect(stripUrlQuery('https://auth.example.com/token?client_secret=secret#access-token')).toBe('https://auth.example.com/token');
    });

    it('can retain query names without values for proxy diagnostics', () => {
        expect(urlWithQueryParameterNames('https://api.example.com/items?cursor=private&filter=secret&cursor=other')).toBe(
            'https://api.example.com/items?cursor&filter&cursor'
        );
    });

    it('retains header names without values', () => {
        expect(headerNamesOnly({ 'x-api-key': 'header-secret', 'x-request-id': 'request-secret' })).toEqual({
            'x-api-key': '<redacted>',
            'x-request-id': '<redacted>'
        });
    });
});
