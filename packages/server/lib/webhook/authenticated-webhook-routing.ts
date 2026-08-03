import { createHash, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { Ok } from '@nangohq/utils';

import type { WebhookHandler, WebhookResponse } from './types.js';

const STATUS_TYPE = 'nango.authenticated-webhook.status';
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const eventTypeSchema = z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value === value.trim());
const connectionIdSchema = z
    .string()
    .min(1)
    .max(255)
    .refine((value) => value === value.trim());

const envelopeSchema = z
    .object({
        type: eventTypeSchema,
        connectionId: connectionIdSchema
    })
    .passthrough();
const statusSchema = z.object({ type: z.literal(STATUS_TYPE), connectionId: connectionIdSchema }).strict();

const metadataSchema = z
    .object({
        authenticated_webhook: z
            .object({
                state: z.enum(['active', 'revoked']),
                token_sha256: z.string().regex(SHA256_PATTERN)
            })
            .strict()
    })
    .passthrough();

function response(statusCode: number, content: Record<string, unknown>) {
    return Ok({ statusCode, content } satisfies WebhookResponse);
}

function bearerToken(headers: Record<string, string>): string | null {
    const authorization = headers['authorization'];
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43,256})$/);
    return match?.[1] ?? null;
}

function authenticated(token: string, verifier: string): boolean {
    if (!SHA256_PATTERN.test(verifier)) return false;
    const supplied = createHash('sha256').update(token).digest();
    const expected = Buffer.from(verifier, 'hex');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const route: WebhookHandler<Record<string, unknown>> = async (nango, headers, body, rawBody) => {
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
        return response(413, { error: 'payload_too_large' });
    }
    const envelope = envelopeSchema.safeParse(body);
    if (!envelope.success) return response(400, { error: 'invalid_body' });
    const { connectionId, type } = envelope.data;

    const connection = await nango.getConnectionForWebhook(connectionId);
    if (!connection) return response(401, { error: 'invalid_credential' });
    const metadata = metadataSchema.safeParse(connection.metadata);
    const token = bearerToken(headers);
    if (!token || !metadata.success || !authenticated(token, metadata.data.authenticated_webhook.token_sha256)) {
        return response(401, { error: 'invalid_credential' });
    }
    if (metadata.data.authenticated_webhook.state === 'revoked') return response(410, { error: 'credential_revoked' });

    if (type === STATUS_TYPE) {
        if (!statusSchema.safeParse(body).success) return response(400, { error: 'invalid_body' });
        return response(200, { active: true, connectionId });
    }

    const dispatched = await nango.executeScriptForWebhooks({
        body,
        webhookType: 'type',
        connectionIdentifier: 'connectionId',
        propName: 'connectionId',
        execution: {
            maxConcurrency: 1,
            retryMax: 3,
            groupByConnection: true
        }
    });
    if (!dispatched.connectionIds.includes(connectionId) || !dispatched.executionCount) {
        return response(503, { error: 'receiver_unavailable' });
    }
    return Ok({
        statusCode: 202,
        content: { accepted: true, connectionId },
        connectionIds: dispatched.connectionIds
    } satisfies WebhookResponse);
};

export { authenticated, bearerToken };
export default route;
