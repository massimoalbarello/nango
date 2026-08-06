import { describe, expect, it } from 'vitest';

import { errorName, headerNamesOnly, sensitiveFields, stripUrlQuery, urlWithQueryParameterNames } from './logging.js';

describe('stripUrlQuery', () => {
    it('removes query values and fragments from absolute and relative URLs', () => {
        expect(stripUrlQuery('https://nango.example/oauth/callback?code=secret&state=secret-state')).toBe('https://nango.example/oauth/callback');
        expect(stripUrlQuery('/oauth/callback?code=secret#fragment-secret')).toBe('/oauth/callback');
        expect(stripUrlQuery('/health')).toBe('/health');
    });
});

describe('urlWithQueryParameterNames', () => {
    it('retains only encoded parameter names for operation diagnostics', () => {
        expect(urlWithQueryParameterNames('https://nango.example/proxy/messages?token=top-secret&cursor=private&cursor=other')).toBe(
            'https://nango.example/proxy/messages?token&cursor&cursor'
        );
    });

    it('never retains query values or fragments', () => {
        const result = urlWithQueryParameterNames('/proxy/messages?authorization=Bearer%20secret&empty=#fragment-secret');

        expect(result).toBe('/proxy/messages?authorization&empty');
        expect(result).not.toContain('secret');
        expect(result).not.toContain('Bearer');
        expect(result).not.toContain('fragment');
    });
});

describe('sensitive log summaries', () => {
    it('retains only field names and presence, never values or error messages', () => {
        const fields = sensitiveFields({ code_verifier: 'pkce-secret', access_token: 'token-secret' });

        expect(fields).toEqual({ present: true, fieldNames: ['code_verifier', 'access_token'] });
        expect(JSON.stringify(fields)).not.toContain('pkce-secret');
        expect(JSON.stringify(fields)).not.toContain('token-secret');
        expect(errorName(new TypeError('provider response contained token-secret'))).toBe('TypeError');
    });

    it('retains header names without values', () => {
        expect(headerNamesOnly({ 'x-api-key': 'header-secret' })).toEqual({ 'x-api-key': '<redacted>' });
    });
});
