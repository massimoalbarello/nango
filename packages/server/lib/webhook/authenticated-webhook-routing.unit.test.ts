import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import route from './authenticated-webhook-routing.js';

const CONNECTION_ID = 'client-1';
const TOKEN = 'a'.repeat(43);
const VERIFIER = createHash('sha256').update(TOKEN).digest('hex');

function mockNango(metadata: Record<string, unknown> | null = { authenticated_webhook: { state: 'active', token_sha256: VERIFIER } }) {
    const execute = vi.fn().mockResolvedValue({
        connectionIds: [CONNECTION_ID],
        connectionMetadata: {},
        executionCount: 1
    });
    const nango = {
        getConnectionForWebhook: vi.fn().mockResolvedValue({ connectionId: CONNECTION_ID, metadata }),
        executeScriptForWebhooks: execute
    } as unknown as Parameters<typeof route>[0];
    return { nango, execute };
}

describe('Authenticated webhook routing', () => {
    it('authenticates before dispatching a connection webhook with reliable delivery options', async () => {
        const { nango, execute } = mockNango();
        const body = validUpsert();
        const result = await route(nango, { authorization: `Bearer ${TOKEN}` }, body, JSON.stringify(body));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.statusCode).toBe(202);
        expect(execute).toHaveBeenCalledWith({
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
    });

    it('answers an authenticated status probe without scheduling work', async () => {
        const { nango, execute } = mockNango();
        const body = { type: 'nango.authenticated-webhook.status', connectionId: CONNECTION_ID };
        const result = await route(nango, { authorization: `Bearer ${TOKEN}` }, body, JSON.stringify(body));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value).toMatchObject({ statusCode: 200, content: { active: true, connectionId: CONNECTION_ID } });
        }
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects invalid credentials before dispatch', async () => {
        const { nango, execute } = mockNango();
        const body = { type: 'example.updated', connectionId: CONNECTION_ID };
        const result = await route(nango, { authorization: `Bearer ${'b'.repeat(43)}` }, body, JSON.stringify(body));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.statusCode).toBe(401);
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects identifiers that would change during normalization', async () => {
        const { nango, execute } = mockNango();
        const body = { type: 'example.updated', connectionId: ` ${CONNECTION_ID} ` };
        const result = await route(nango, { authorization: `Bearer ${TOKEN}` }, body, JSON.stringify(body));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.statusCode).toBe(400);
        expect(nango.getConnectionForWebhook).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects revoked installations before dispatch', async () => {
        const { nango, execute } = mockNango({ authenticated_webhook: { state: 'revoked', token_sha256: VERIFIER } });
        const body = { type: 'example.updated', connectionId: CONNECTION_ID };
        const result = await route(nango, { authorization: `Bearer ${TOKEN}` }, body, JSON.stringify(body));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.statusCode).toBe(410);
        expect(execute).not.toHaveBeenCalled();
    });

    it('does not disclose whether an installation exists to an unauthenticated caller', async () => {
        const { nango, execute } = mockNango();
        vi.mocked(nango.getConnectionForWebhook).mockResolvedValueOnce(null);
        const body = { type: 'nango.authenticated-webhook.status', connectionId: 'unknown' };
        const result = await route(nango, { authorization: `Bearer ${TOKEN}` }, body, JSON.stringify(body));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.statusCode).toBe(401);
        expect(execute).not.toHaveBeenCalled();
    });

    it('leaves provider payload validation to the deployed webhook function', async () => {
        const { nango, execute } = mockNango();
        const body = { ...validUpsert(), providerSpecific: { arbitrary: true } };
        const result = await route(nango, { authorization: `Bearer ${TOKEN}` }, body, JSON.stringify(body));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.statusCode).toBe(202);
        expect(execute).toHaveBeenCalledOnce();
    });

    it('does not acknowledge an event when no webhook function was scheduled', async () => {
        const { nango, execute } = mockNango();
        execute.mockResolvedValueOnce({ connectionIds: [CONNECTION_ID], connectionMetadata: {}, executionCount: 0 });
        const body = validUpsert();
        const result = await route(nango, { authorization: `Bearer ${TOKEN}` }, body, JSON.stringify(body));

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.statusCode).toBe(503);
    });
});

function validUpsert() {
    return {
        type: 'example.updated',
        connectionId: CONNECTION_ID,
        batchId: 'batch-1',
        sentAt: '2026-08-01T10:00:00.000Z',
        payload: { id: 'example-1' }
    };
}
