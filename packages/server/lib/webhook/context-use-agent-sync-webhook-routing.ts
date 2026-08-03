import { createHash, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { Ok } from '@nangohq/utils';

import type { WebhookHandler, WebhookResponse } from './types.js';

const UPSERT_TYPE = 'agent.conversation.upsert';
const STATUS_TYPE = 'agent.sync.status';
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const recordSchema = z
    .object({
        id: z.string().min(1),
        created_at: z.iso.datetime({ offset: true }),
        updated_at: z.iso.datetime({ offset: true }),
        participants: z.array(z.string().min(1)),
        body: z.string().min(1)
    })
    .strict();
const upsertSchema = z
    .object({
        type: z.literal(UPSERT_TYPE),
        connectionId: z.string().min(1),
        batchId: z.string().min(1).max(200),
        sentAt: z.iso.datetime({ offset: true }),
        records: z.array(recordSchema).min(1).max(100)
    })
    .strict();
const statusSchema = z.object({ type: z.literal(STATUS_TYPE), connectionId: z.string().min(1) }).strict();

type AgentSyncMetadata = {
    state?: unknown;
    token_sha256?: unknown;
};

function response(statusCode: number, content: Record<string, unknown>) {
    return Ok({ statusCode, content } satisfies WebhookResponse);
}

function bearerToken(headers: Record<string, string>): string | null {
    const authorization = headers['authorization'];
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43,})$/);
    return match?.[1] ?? null;
}

function authenticated(token: string, verifier: string): boolean {
    if (!SHA256_PATTERN.test(verifier)) return false;
    const supplied = createHash('sha256').update(token).digest();
    const expected = Buffer.from(verifier, 'hex');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const route: WebhookHandler<Record<string, unknown>> = async (nango, headers, body, rawBody) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return response(400, { error: 'invalid_body' });
    }
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
        return response(413, { error: 'payload_too_large' });
    }

    const connectionId = typeof body['connectionId'] === 'string' ? body['connectionId'] : null;
    const type = typeof body['type'] === 'string' ? body['type'] : null;
    if (!connectionId || (type !== UPSERT_TYPE && type !== STATUS_TYPE)) {
        return response(400, { error: 'invalid_body' });
    }

    const connection = await nango.getConnectionForWebhook(connectionId);
    if (!connection) return response(401, { error: 'invalid_credential' });
    const metadata = (connection.metadata ?? {}) as AgentSyncMetadata;
    const token = bearerToken(headers);
    if (!token || typeof metadata.token_sha256 !== 'string' || !authenticated(token, metadata.token_sha256)) {
        return response(401, { error: 'invalid_credential' });
    }
    if (metadata.state === 'revoked') return response(410, { error: 'installation_revoked' });
    if (metadata.state !== 'active') return response(401, { error: 'installation_not_active' });

    if (type === STATUS_TYPE) {
        if (!statusSchema.safeParse(body).success) return response(400, { error: 'invalid_body' });
        return response(200, { active: true, connectionId });
    }

    if (!upsertSchema.safeParse(body).success) return response(400, { error: 'invalid_body' });

    const dispatched = await nango.executeScriptForWebhooks({
        body,
        webhookType: 'type',
        connectionIdentifier: 'connectionId',
        propName: 'connectionId'
    });
    if (!dispatched.connectionIds.includes(connectionId)) {
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
