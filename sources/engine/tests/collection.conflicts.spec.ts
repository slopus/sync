/**
 * Level 4: Conflict Resolution
 * Tests for Last-Write-Wins (LWW) and out-of-order operations
 */

import { describe, it, expect } from 'vitest';
import {
    Collection,
    createItemId,
    createOperationId,
    mutableAt,
    type Mutable,
} from '../index';
import { isAccepted, getReason } from './test-helpers';

describe('Collection - Conflicts', () => {
    describe('Last-Write-Wins (LWW)', () => {
        it('should accept updates with newer timestamps', () => {
            const collection = new Collection<{
                title: Mutable<string>;
            }>('items');

            const itemId = createItemId();
            const t1 = 1000;
            const t2 = 2000;

            // Create at t1
            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: { id: itemId, title: mutableAt('Version 1', t1) },
                },
            ]);

            // Update with newer timestamp (t2)
            const updateOp = createOperationId();
            const results = collection.applyDiff([
                {
                    opId: updateOp,
                    type: 'update',
                    id: itemId,
                    changes: { title: mutableAt('Version 2', t2) },
                },
            ]);

            expect(isAccepted(results, updateOp)).toBe(true);

            const item = collection.readOne(itemId);
            expect(item?.title.value).toBe('Version 2');
            expect(item?.title.changedAt).toBe(t2);
        });

        it('should reject updates with older timestamps', () => {
            const collection = new Collection<{
                title: Mutable<string>;
            }>('items');

            const itemId = createItemId();
            const t1 = 1000;
            const t2 = 2000;

            // Create at t2
            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: { id: itemId, title: mutableAt('Version 2', t2) },
                },
            ]);

            // Try to update with older timestamp (t1)
            const updateOp = createOperationId();
            const results = collection.applyDiff([
                {
                    opId: updateOp,
                    type: 'update',
                    id: itemId,
                    changes: { title: mutableAt('Version 1', t1) },
                },
            ]);

            expect(isAccepted(results, updateOp)).toBe(false);
            expect(getReason(results, updateOp)).toBe('No changes to apply');

            // Value should remain unchanged
            const item = collection.readOne(itemId);
            expect(item?.title.value).toBe('Version 2');
            expect(item?.title.changedAt).toBe(t2);
        });

        it('should handle same timestamp with different values', () => {
            const collection = new Collection<{
                title: Mutable<string>;
            }>('items');

            const itemId = createItemId();
            const t = 1000;

            // Create with value A
            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: { id: itemId, title: mutableAt('Value A', t) },
                },
            ]);

            // Update with value B at same timestamp
            const updateOp = createOperationId();
            const results = collection.applyDiff([
                {
                    opId: updateOp,
                    type: 'update',
                    id: itemId,
                    changes: { title: mutableAt('Value B', t) },
                },
            ]);

            // Should accept and use current time
            expect(isAccepted(results, updateOp)).toBe(true);

            const item = collection.readOne(itemId);
            expect(item?.title.value).toBe('Value B');
            // Timestamp should be updated to "now" to break the tie
            expect(item?.title.changedAt).toBeGreaterThan(t);
        });

        it('should ignore same timestamp with same value', () => {
            const collection = new Collection<{
                title: Mutable<string>;
            }>('items');

            const itemId = createItemId();
            const t = 1000;

            // Create
            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: { id: itemId, title: mutableAt('Same Value', t) },
                },
            ]);

            // Update with same value and timestamp
            const updateOp = createOperationId();
            const results = collection.applyDiff([
                {
                    opId: updateOp,
                    type: 'update',
                    id: itemId,
                    changes: { title: mutableAt('Same Value', t) },
                },
            ]);

            expect(isAccepted(results, updateOp)).toBe(false);
            expect(getReason(results, updateOp)).toBe('No changes to apply');
        });
    });

    describe('Out-of-Order Operations', () => {
        it('should handle operations arriving in wrong order', () => {
            const collection = new Collection<{
                title: Mutable<string>;
            }>('items');

            const itemId = createItemId();
            const t0 = 1000;
            const t1 = 2000;
            const t2 = 3000;
            const t3 = 4000;

            // Create at t0
            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: { id: itemId, title: mutableAt('Initial', t0) },
                },
            ]);

            // Apply updates in shuffled order
            const op1 = createOperationId(); // t1
            const op2 = createOperationId(); // t2
            const op3 = createOperationId(); // t3

            const results = collection.applyDiff([
                {
                    opId: op2,
                    type: 'update',
                    id: itemId,
                    changes: { title: mutableAt('Middle', t2) },
                },
                {
                    opId: op1,
                    type: 'update',
                    id: itemId,
                    changes: { title: mutableAt('Old', t1) },
                },
                {
                    opId: op3,
                    type: 'update',
                    id: itemId,
                    changes: { title: mutableAt('Newest', t3) },
                },
            ]);

            // op2 (t2) should succeed - first and newer than t0
            expect(isAccepted(results, op2)).toBe(true);

            // op1 (t1) should fail - older than current t2
            expect(isAccepted(results, op1)).toBe(false);

            // op3 (t3) should succeed - newer than t2
            expect(isAccepted(results, op3)).toBe(true);

            // Final state should have the newest value
            const item = collection.readOne(itemId);
            expect(item?.title.value).toBe('Newest');
            expect(item?.title.changedAt).toBe(t3);
        });

        it('should converge to same state regardless of update order', () => {
            const collection1 = new Collection<{
                value: Mutable<number>;
            }>('test');

            const collection2 = new Collection<{
                value: Mutable<number>;
            }>('test');

            const itemId = createItemId();

            // Create operation (must be applied first on both)
            const createOp = {
                opId: createOperationId(),
                type: 'create' as const,
                item: { id: itemId, value: mutableAt(0, 1000) },
            };

            const updateOps = [
                {
                    opId: createOperationId(),
                    type: 'update' as const,
                    id: itemId,
                    changes: { value: mutableAt(1, 2000) },
                },
                {
                    opId: createOperationId(),
                    type: 'update' as const,
                    id: itemId,
                    changes: { value: mutableAt(2, 3000) },
                },
                {
                    opId: createOperationId(),
                    type: 'update' as const,
                    id: itemId,
                    changes: { value: mutableAt(3, 4000) },
                },
            ];

            // Apply create, then updates in order
            collection1.applyDiff([createOp]);
            collection1.applyDiff(updateOps);

            // Apply create, then updates in reverse order
            collection2.applyDiff([createOp]);
            collection2.applyDiff([...updateOps].reverse());

            // Both should converge to same state (highest timestamp wins)
            const item1 = collection1.readOne(itemId);
            const item2 = collection2.readOne(itemId);

            expect(item1?.value.value).toBe(3);
            expect(item2?.value.value).toBe(3);
            expect(item1?.value.changedAt).toBe(4000);
            expect(item2?.value.changedAt).toBe(4000);
        });
    });

    describe('Multi-Field Conflicts', () => {
        it('should resolve conflicts independently per field', () => {
            const collection = new Collection<{
                fieldA: Mutable<string>;
                fieldB: Mutable<string>;
            }>('items');

            const itemId = createItemId();

            // Create with both fields at t1
            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        fieldA: mutableAt('A1', 1000),
                        fieldB: mutableAt('B1', 1000),
                    },
                },
            ]);

            // Update: fieldA newer (t3), fieldB older (t0)
            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: itemId,
                    changes: {
                        fieldA: mutableAt('A2', 3000),  // Newer - should apply
                        fieldB: mutableAt('B0', 500),   // Older - should reject
                    },
                },
            ]);

            const item = collection.readOne(itemId);
            expect(item?.fieldA.value).toBe('A2');
            expect(item?.fieldA.changedAt).toBe(3000);
            expect(item?.fieldB.value).toBe('B1');
            expect(item?.fieldB.changedAt).toBe(1000);
        });
    });
});
