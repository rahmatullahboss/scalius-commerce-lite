import type { Database } from "@scalius/database/client";
import { domainOutboxEvents } from "@scalius/database/schema";
import type { BatchItem } from "drizzle-orm/batch";

const MAX_OUTBOX_PAYLOAD_BYTES = 16 * 1024;
const SENSITIVE_KEY_PATTERN = /(?:password|passcode|secret|token|encrypted|account[_-]?number|storage[_-]?key|document[_-]?url|kyc)/i;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface BuildDomainOutboxEventInput {
    id?: string;
    eventKey: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    schemaVersion?: number;
    payload: Record<string, unknown>;
    createdAt?: Date;
}

export type DomainOutboxEventInsert = typeof domainOutboxEvents.$inferInsert;

function assertNonEmpty(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} is required.`);
}

function toSerializableJson(
    value: unknown,
    seen: WeakSet<object>,
    path: string,
): JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`Outbox payload must be JSON serializable; ${path} is not finite.`);
        }
        return value;
    }
    if (
        typeof value === "undefined" ||
        typeof value === "function" ||
        typeof value === "symbol" ||
        typeof value === "bigint"
    ) {
        throw new Error(`Outbox payload must be JSON serializable; unsupported value at ${path}.`);
    }
    if (value instanceof Date) {
        throw new Error(`Outbox payload must be JSON serializable without Date objects at ${path}.`);
    }
    if (Array.isArray(value)) {
        if (seen.has(value)) {
            throw new Error(`Outbox payload must be JSON serializable; circular reference at ${path}.`);
        }
        seen.add(value);
        const result = value.map((entry, index) =>
            toSerializableJson(entry, seen, `${path}[${index}]`),
        );
        seen.delete(value);
        return result;
    }
    if (typeof value === "object") {
        if (seen.has(value)) {
            throw new Error(`Outbox payload must be JSON serializable; circular reference at ${path}.`);
        }
        seen.add(value);
        const result: Record<string, JsonValue> = {};
        for (const [key, entry] of Object.entries(value)) {
            if (SENSITIVE_KEY_PATTERN.test(key)) {
                throw new Error(`Sensitive payload key is not allowed in domain outbox: ${key}`);
            }
            result[key] = toSerializableJson(entry, seen, `${path}.${key}`);
        }
        seen.delete(value);
        return result;
    }
    throw new Error(`Outbox payload must be JSON serializable at ${path}.`);
}

export function buildDomainOutboxEvent(
    input: BuildDomainOutboxEventInput,
): DomainOutboxEventInsert {
    assertNonEmpty(input.eventKey, "Outbox event key");
    assertNonEmpty(input.aggregateType, "Outbox aggregate type");
    assertNonEmpty(input.aggregateId, "Outbox aggregate ID");
    assertNonEmpty(input.eventType, "Outbox event type");

    const schemaVersion = input.schemaVersion ?? 1;
    if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
        throw new Error("Outbox schema version must be a positive integer.");
    }
    const createdAt = input.createdAt ?? new Date();
    if (Number.isNaN(createdAt.getTime())) {
        throw new Error("Outbox createdAt must be a valid date.");
    }

    const payload = toSerializableJson(input.payload, new WeakSet(), "payload");
    if (Array.isArray(payload) || payload === null || typeof payload !== "object") {
        throw new Error("Outbox payload must be a JSON object.");
    }
    const serializedPayload = JSON.stringify(payload);
    const payloadBytes = new TextEncoder().encode(serializedPayload).byteLength;
    if (payloadBytes > MAX_OUTBOX_PAYLOAD_BYTES) {
        throw new Error(
            `Outbox payload exceeds ${MAX_OUTBOX_PAYLOAD_BYTES} byte limit (${payloadBytes} bytes).`,
        );
    }

    return {
        id: input.id ?? crypto.randomUUID(),
        eventKey: input.eventKey.trim(),
        aggregateType: input.aggregateType.trim(),
        aggregateId: input.aggregateId.trim(),
        eventType: input.eventType.trim(),
        schemaVersion,
        payload,
        status: "pending",
        attempts: 0,
        createdAt,
    };
}

export function createDomainOutboxInsertStatement(
    db: Database,
    input: BuildDomainOutboxEventInput,
): BatchItem<"sqlite"> {
    const event = buildDomainOutboxEvent(input);
    return db
        .insert(domainOutboxEvents)
        .values(event)
        .onConflictDoNothing({ target: domainOutboxEvents.eventKey }) as BatchItem<"sqlite">;
}
