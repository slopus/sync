/**
 * Level 3: Timestamp Handling
 * Tests for timestamp clamping and mutable field behavior
 */

import { describe, it, expect } from 'vitest';
import {
    Collection,
    createItemId,
    createOperationId,
    mutable,
    mutableAt,
    type Mutable,
} from '../index';
import { isAccepted } from './test-helpers';

describe('Collection - Timestamps', () => {
    describe('Timestamp Clamping', () => {
        it('should clamp future timestamps on create', () => {
            const collection = new Collection<{ title: Mutable<string> }>('items');

            const itemId = createItemId();
            const futureTime = Date.now() + 10000; // 10 seconds in future

            const opId = createOperationId();
            collection.applyDiff([
                {
                    opId,
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutableAt('Test', futureTime),
                    },
                },
            ]);

            const item = collection.readOne(itemId);
            expect(item?.title.value).toBe('Test');
            // Timestamp should be clamped to now (not in future)
            expect(item?.title.changedAt).toBeLessThanOrEqual(Date.now());
            expect(item?.title.changedAt).toBeLessThan(futureTime);
        });

        it('should clamp future timestamps on update', () => {
            const collection = new Collection<{ title: Mutable<string> }>('items');

            const itemId = createItemId();

            // Create with normal timestamp
            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: { id: itemId, title: mutableAt('Initial', 1000) },
                },
            ]);

            // Update with future timestamp
            const futureTime = Date.now() + 10000;
            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: itemId,
                    changes: { title: mutableAt('Updated', futureTime) },
                },
            ]);

            const item = collection.readOne(itemId);
            expect(item?.title.value).toBe('Updated');
            expect(item?.title.changedAt).toBeLessThanOrEqual(Date.now());
            expect(item?.title.changedAt).toBeLessThan(futureTime);
        });

        it('should preserve past timestamps', () => {
            const collection = new Collection<{ title: Mutable<string> }>('items');

            const itemId = createItemId();
            const pastTime = 1234567890;

            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutableAt('Test', pastTime),
                    },
                },
            ]);

            const item = collection.readOne(itemId);
            expect(item?.title.changedAt).toBe(pastTime);
        });
    });

    describe('Nullable Mutable Fields', () => {
        it('should handle null values in mutable fields', () => {
            const collection = new Collection<{
                description: Mutable<string>;
            }>('items');

            const itemId = createItemId();

            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        description: mutable(null),
                    },
                },
            ]);

            const item1 = collection.readOne(itemId);
            expect(item1?.description.value).toBeNull();
        });

        it('should transition from null to value', () => {
            const collection = new Collection<{
                description: Mutable<string>;
            }>('items');

            const itemId = createItemId();

            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        description: mutable(null),
                    },
                },
            ]);

            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: itemId,
                    changes: { description: mutable('Now has value') },
                },
            ]);

            const item = collection.readOne(itemId);
            expect(item?.description.value).toBe('Now has value');
        });

        it('should transition from value to null', () => {
            const collection = new Collection<{
                description: Mutable<string>;
            }>('items');

            const itemId = createItemId();

            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        description: mutable('Has value'),
                    },
                },
            ]);

            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: itemId,
                    changes: { description: mutable(null) },
                },
            ]);

            const item = collection.readOne(itemId);
            expect(item?.description.value).toBeNull();
        });
    });

    describe('Multiple Mutable Fields', () => {
        it('should handle items with multiple mutable fields', () => {
            const collection = new Collection<{
                title: Mutable<string>;
                status: Mutable<string>;
                priority: Mutable<number>;
            }>('tasks');

            const itemId = createItemId();

            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutable('Task'),
                        status: mutable('pending'),
                        priority: mutable(1),
                    },
                },
            ]);

            const item = collection.readOne(itemId);
            expect(item?.title.value).toBe('Task');
            expect(item?.status.value).toBe('pending');
            expect(item?.priority.value).toBe(1);
        });

        it('should update individual fields independently', () => {
            const collection = new Collection<{
                title: Mutable<string>;
                status: Mutable<string>;
            }>('tasks');

            const itemId = createItemId();

            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutableAt('Task', 1000),
                        status: mutableAt('pending', 1000),
                    },
                },
            ]);

            // Update only status
            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: itemId,
                    changes: { status: mutableAt('done', 2000) },
                },
            ]);

            const item = collection.readOne(itemId);
            expect(item?.title.value).toBe('Task');
            expect(item?.title.changedAt).toBe(1000); // Unchanged
            expect(item?.status.value).toBe('done');
            expect(item?.status.changedAt).toBe(2000); // Updated
        });
    });
});
