import tracer from 'dd-trace';

import { stripUrlQuery } from './utils/logging.js';

import type { Span } from 'dd-trace';
import type { ClientRequest, IncomingMessage } from 'node:http';

tracer.init({
    service: 'nango',
    clientIpEnabled: true,
    clientIpHeader: 'x-forwarded-for',
    samplingRules: [
        { service: 'server-net', sampleRate: 0.01, name: '*' },
        { service: 'nango-elasticsearch', sampleRate: 0.1, name: '*' },
        { service: 'nango-redis', sampleRate: 0.1, name: '*' }
    ]
});
tracer.use('pg', {
    service: (params: { database: string }) => `postgres-${params.database}`
});
tracer.use('elasticsearch', {
    service: 'nango-elasticsearch'
});

const redactAutomaticHttpUrl = (span?: Span, req?: IncomingMessage | ClientRequest) => {
    const request = req as ((IncomingMessage | ClientRequest) & { originalUrl?: string }) | undefined;
    const url = request?.originalUrl ?? (request as IncomingMessage | undefined)?.url ?? (request as ClientRequest | undefined)?.path;
    if (span && url) {
        span.setTag('http.url', stripUrlQuery(url));
    }
};

// dd-trace's default obfuscator replaces only selected query values. OAuth
// providers and proxy callers can use arbitrary parameter names, so strip every
// query string at both instrumentation layers. The request hook also overwrites
// the final Express span tag after framework instrumentation has run.
const expressTracingConfig = {
    queryStringObfuscation: true,
    hooks: { request: redactAutomaticHttpUrl }
};
tracer.use('express', expressTracingConfig);
const httpTracingConfig = {
    headers: ['x-forwarded-for'],
    queryStringObfuscation: true,
    hooks: { request: redactAutomaticHttpUrl },
    blocklist: ['/health', '/favicon.ico', '/logo-dark.svg', '/logo-text.svg', /^\/static\//, /^\/images\//, '/manifest.json']
};
tracer.use('http', httpTracingConfig);
tracer.use('net', {
    enabled: true,
    service: 'server-net'
});
tracer.use('dns', {
    enabled: false
});
