import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import route from './context-use-agent-sync-webhook-routing.js';

const CONNECTION_ID = 'agent-sync';
const TOKEN = 'a'.repeat(43);
const VERIFIER = createHash('sha256').update(TOKEN).digest('hex');

function mockNango(metadata: Record<string, unknown> | null = { state: 'active', token_sha256: VERIFIER }) {
    const execute = vi.fn().mockResolvedValue({
        connectionIds: [CONNECTION_ID],
        connectionMetadata: {}
    });
    const nango = {
        getConnectionForWebhook: vi.fn().mockResolvedValue({ connectionId: CONNECTION_ID, metadata }),
        executeScriptForWebhooks: execute
    } as unknown as Parameters<typeof route>[0];
    return { nango, execute };
}

describe('Context Use agent-sync webhook routing', () => {
    it('authenticates before dispatching the fixed connection webhook', async () => {
        const { nango, execute } = mockNango();
        const body = validUpsert();
        const result = await route(nango, { authorization: `Bearer ${TOKEN}` }, body, JSON.stringify(body));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.statusCode).toBe(202);
        expect(execute).toHaveBeenCalledWith({
            body,
            webhookType: 'type',
            connectionIdentifier: 'connectionId',
            propName: 'connectionId'
        });
    });

    it('answers an authenticated status probe without scheduling work', async () => {
        const { nango, execute } = mockNango();
        const body = { type: 'agent.sync.status', connectionId: CONNECTION_ID };
        const result = await route(nango, { authorization: `Bearer ${TOKEN}` }, body, JSON.stringify(body));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value).toMatchObject({ statusCode: 200, content: { active: true, connectionId: CONNECTION_ID } });
        }
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects invalid credentials before dispatch', async () => {
        const { nango, execute } = mockNango();
        const body = { type: 'agent.conversation.upsert', connectionId: CONNECTION_ID };
        const result = await route(nango, { authorization: `Bearer ${'b'.repeat(43)}` }, body, JSON.stringify(body));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.statusCode).toBe(401);
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects revoked installations before dispatch', async () => {
        const { nango, execute } = mockNango({ state: 'revoked', token_sha256: VERIFIER });
        const body = { type: 'agent.conversation.upsert', connectionId: CONNECTION_ID };
        const result = await route(nango, { authorization: `Bearer ${TOKEN}` }, body, JSON.stringify(body));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.statusCode).toBe(410);
        expect(execute).not.toHaveBeenCalled();
    });

    it('does not disclose whether an installation exists to an unauthenticated caller', async () => {
        const { nango, execute } = mockNango();
        vi.mocked(nango.getConnectionForWebhook).mockResolvedValueOnce(null);
        const body = { type: 'agent.sync.status', connectionId: 'unknown' };
        const result = await route(nango, { authorization: `Bearer ${TOKEN}` }, body, JSON.stringify(body));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.statusCode).toBe(401);
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects a malformed universal record after authentication and before dispatch', async () => {
        const { nango, execute } = mockNango();
        const body = { ...validUpsert(), records: [{ ...validUpsert().records[0], provider: 'codex' }] };
        const result = await route(nango, { authorization: `Bearer ${TOKEN}` }, body, JSON.stringify(body));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.statusCode).toBe(400);
        expect(execute).not.toHaveBeenCalled();
    });
});

function validUpsert() {
    return {
        type: 'agent.conversation.upsert',
        connectionId: CONNECTION_ID,
        batchId: 'batch-1',
        sentAt: '2026-08-01T10:00:00.000Z',
        records: [
            {
                id: 'conversation-1',
                created_at: '2026-08-01T09:00:00.000Z',
                updated_at: '2026-08-01T10:00:00.000Z',
                participants: [],
                body: '# Agent conversation'
            }
        ]
    };
}
