/**
 * Tests for ClientCollection - Client-side collection with operation rebasing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    ClientCollection,
    createItemId,
    createOperationId,
    mutable,
    mutableAt,
    type Mutable,
    type Diff,
    type Item,
} from '../index';
import { isAccepted, getReason } from './test-helpers';

type TodoShape = {
    title: Mutable<string>;
    completed: Mutable<boolean>;
};

describe('ClientCollection', () => {
    describe('Construction and Basic Reading', () => {
        it('should create a client collection with a name', () => {
            const client = new ClientCollection<TodoShape>('todos');

            expect(client.name).toBe('todos');
        });

        it('should start with empty state', () => {
            const client = new ClientCollection<TodoShape>('todos');

            expect(client.read()).toEqual([]);
            expect(client.readServerState()).toEqual([]);
            expect(client.getPendingCount()).toBe(0);
        });

        it('should accept custom configuration', () => {
            const client = new ClientCollection<TodoShape>('todos', {
                maxPendingAge: 1000,
            });

            expect(client.name).toBe('todos');
        });
    });

    describe('Local Operations', () => {
        it('should apply local create operation', () => {
            const client = new ClientCollection<TodoShape>('todos');

            const itemId = createItemId();
            const opId = createOperationId();

            const results = client.applyLocal([
                {
                    opId,
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutable('Buy milk'),
                        completed: mutable(false),
                    },
                },
            ]);

            expect(isAccepted(results, opId)).toBe(true);
            expect(client.read()).toHaveLength(1);
            expect(client.getPendingCount()).toBe(1);

            const pending = client.getPendingOperations();
            expect(pending).toHaveLength(1);
            expect(pending[0].opId).toBe(opId);
        });

        it('should track pending operation metadata', () => {
            const client = new ClientCollection<TodoShape>('todos');

            const itemId = createItemId();
            const opId = createOperationId();

            const before = Date.now();
            client.applyLocal([
                {
                    opId,
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutable('Buy milk'),
                        completed: mutable(false),
                    },
                },
            ]);
            const after = Date.now();

            const metadata = client.getPendingMetadata();
            expect(metadata).toHaveLength(1);
            expect(metadata[0].operation.opId).toBe(opId);
            expect(metadata[0].createdAt).toBeGreaterThanOrEqual(before);
            expect(metadata[0].createdAt).toBeLessThanOrEqual(after);
            expect(metadata[0].lastRebaseAt).toBe(metadata[0].createdAt);
        });

        it('should apply local update operation', () => {
            const client = new ClientCollection<TodoShape>('todos');
            const itemId = createItemId();

            // Create item from server
            client.applyServerUpdate([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutable('Original'),
                        completed: mutable(false),
                    },
                },
            ]);

            // Update locally
            const opId = createOperationId();
            const results = client.applyLocal([
                {
                    opId,
                    type: 'update',
                    id: itemId,
                    changes: {
                        title: mutable('Updated'),
                    },
                },
            ]);

            expect(isAccepted(results, opId)).toBe(true);
            expect(client.getPendingCount()).toBe(1);

            const item = client.readOne(itemId);
            expect(item?.title.value).toBe('Updated');
        });

        it('should not track rejected operations as pending', () => {
            const client = new ClientCollection<TodoShape>('todos');

            const opId = createOperationId();

            // Try to update non-existent item
            const results = client.applyLocal([
                {
                    opId,
                    type: 'update',
                    id: 'non-existent',
                    changes: {
                        title: mutable('Test'),
                    },
                },
            ]);

            expect(isAccepted(results, opId)).toBe(false);
            expect(client.getPendingCount()).toBe(0);
        });
    });

    describe('Server Updates', () => {
        it('should apply server operations to server state', () => {
            const client = new ClientCollection<TodoShape>('todos');

            const itemId = createItemId();
            const opId = createOperationId();

            client.applyServerUpdate([
                {
                    opId,
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutable('Server item'),
                        completed: mutable(false),
                    },
                },
            ]);

            expect(client.read()).toHaveLength(1);
            expect(client.readServerState()).toHaveLength(1);
            expect(client.getPendingCount()).toBe(0);

            const item = client.readOne(itemId);
            expect(item?.title.value).toBe('Server item');
        });

        it('should remove matching pending operations on server update', () => {
            const client = new ClientCollection<TodoShape>('todos');

            const itemId = createItemId();
            const opId = createOperationId();

            // Apply local operation
            client.applyLocal([
                {
                    opId,
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutable('Local item'),
                        completed: mutable(false),
                    },
                },
            ]);

            expect(client.getPendingCount()).toBe(1);

            // Server confirms the same operation
            client.applyServerUpdate([
                {
                    opId,
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutable('Local item'),
                        completed: mutable(false),
                    },
                },
            ]);

            expect(client.getPendingCount()).toBe(0);
        });
    });

    describe('Operation Rebasing', () => {
        it('should rebase pending operations on server update', () => {
            const client = new ClientCollection<TodoShape>('todos');
            const itemId = createItemId();

            // Server creates item
            client.applyServerUpdate([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutableAt('Original', 1000),
                        completed: mutableAt(false, 1000),
                    },
                },
            ]);

            // User edits locally (newer timestamp)
            client.applyLocal([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: itemId,
                    changes: {
                        title: mutableAt('Local Edit', 2000),
                    },
                },
            ]);

            expect(client.getPendingCount()).toBe(1);

            // Server update with older edit
            client.applyServerUpdate([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: itemId,
                    changes: {
                        title: mutableAt('Server Edit', 1500),
                    },
                },
            ]);

            // Pending operation should still apply (newer timestamp)
            const item = client.readOne(itemId);
            expect(item?.title.value).toBe('Local Edit');
            expect(client.getPendingCount()).toBe(1);
        });

        it('should remove pending operation immediately when server deletes the item', () => {
            const client = new ClientCollection<TodoShape>('todos');
            const itemId = createItemId();

            // Server creates item
            client.applyServerUpdate([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutableAt('Original', 1000),
                        completed: mutableAt(false, 1000),
                    },
                },
            ]);

            // User edits locally
            client.applyLocal([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: itemId,
                    changes: {
                        title: mutable('Local Edit'),
                    },
                },
            ]);

            expect(client.getPendingCount()).toBe(1);

            // Server deletes the item - this makes the update operation invalid
            client.applyServerUpdate([
                {
                    opId: createOperationId(),
                    type: 'delete',
                    id: itemId,
                },
            ]);

            // Pending operation should be removed immediately because it failed to rebase
            expect(client.getPendingCount()).toBe(0);
        });

        it('should remove pending create operation when item already exists on server', () => {
            const client = new ClientCollection<TodoShape>('todos');
            const itemId = createItemId();

            // User creates item locally
            client.applyLocal([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutable('Local Item'),
                        completed: mutable(false),
                    },
                },
            ]);

            expect(client.getPendingCount()).toBe(1);

            // Server creates same item (maybe another user created it)
            client.applyServerUpdate([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutable('Server Item'),
                        completed: mutable(true),
                    },
                },
            ]);

            // Pending create should be removed because it failed to rebase (item already exists)
            expect(client.getPendingCount()).toBe(0);

            // View should show server item
            const item = client.readOne(itemId);
            expect(item?.title.value).toBe('Server Item');
        });

        it('should update lastRebaseAt timestamp on successful rebase', () => {
            const client = new ClientCollection<TodoShape>('todos');
            const itemId = createItemId();

            // Server creates item
            client.applyServerUpdate([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutableAt('Original', 1000),
                        completed: mutableAt(false, 1000),
                    },
                },
            ]);

            // User edits locally
            const before = Date.now();
            client.applyLocal([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: itemId,
                    changes: {
                        title: mutable('Local Edit'),
                    },
                },
            ]);
            const after = Date.now();

            const metadataBefore = client.getPendingMetadata()[0];
            expect(metadataBefore.lastRebaseAt).toBeGreaterThanOrEqual(before);
            expect(metadataBefore.lastRebaseAt).toBeLessThanOrEqual(after);

            // Trigger rebase
            const beforeRebase = Date.now();
            client.rebase();
            const afterRebase = Date.now();

            const metadataAfter = client.getPendingMetadata()[0];
            expect(metadataAfter.lastRebaseAt).toBeGreaterThanOrEqual(beforeRebase);
            expect(metadataAfter.lastRebaseAt).toBeLessThanOrEqual(afterRebase);
        });
    });

    describe('Operation Removal', () => {
        it('should remove operations by ID', () => {
            const client = new ClientCollection<TodoShape>('todos');

            const opId1 = createOperationId();
            const opId2 = createOperationId();

            client.applyLocal([
                {
                    opId: opId1,
                    type: 'create',
                    item: {
                        id: createItemId(),
                        title: mutable('Item 1'),
                        completed: mutable(false),
                    },
                },
                {
                    opId: opId2,
                    type: 'create',
                    item: {
                        id: createItemId(),
                        title: mutable('Item 2'),
                        completed: mutable(false),
                    },
                },
            ]);

            expect(client.getPendingCount()).toBe(2);

            const removed = client.removeOperations([opId1]);
            expect(removed).toBe(1);
            expect(client.getPendingCount()).toBe(1);

            const pending = client.getPendingOperations();
            expect(pending[0].opId).toBe(opId2);
        });

        it('should return 0 when removing non-existent operations', () => {
            const client = new ClientCollection<TodoShape>('todos');

            const removed = client.removeOperations(['non-existent']);
            expect(removed).toBe(0);
        });

        it('should rebase remaining operations after server confirms one', () => {
            const client = new ClientCollection<TodoShape>('todos');
            const itemId = createItemId();

            // Create item locally
            const opId1 = createOperationId();
            client.applyLocal([
                {
                    opId: opId1,
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutable('Item'),
                        completed: mutable(false),
                    },
                },
            ]);

            // Update it locally
            const opId2 = createOperationId();
            client.applyLocal([
                {
                    opId: opId2,
                    type: 'update',
                    id: itemId,
                    changes: {
                        title: mutable('Updated'),
                    },
                },
            ]);

            expect(client.getPendingCount()).toBe(2);

            // Server confirms the create operation
            client.applyServerUpdate([
                {
                    opId: opId1,
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutable('Item'),
                        completed: mutable(false),
                    },
                },
            ]);

            // Create is confirmed (removed from pending), update should still be pending and rebased
            expect(client.getPendingCount()).toBe(1);
            const pending = client.getPendingOperations();
            expect(pending[0].opId).toBe(opId2);
        });
    });

    describe('Pending Operation Cleanup', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should remove operations older than maxPendingAge', () => {
            const client = new ClientCollection<TodoShape>('todos', {
                maxPendingAge: 1000, // 1 second
            });

            const opId = createOperationId();

            // Create operation at t=0
            vi.setSystemTime(0);
            client.applyLocal([
                {
                    opId,
                    type: 'create',
                    item: {
                        id: createItemId(),
                        title: mutable('Old item'),
                        completed: mutable(false),
                    },
                },
            ]);

            expect(client.getPendingCount()).toBe(1);

            // Advance time past maxPendingAge
            vi.setSystemTime(1500);

            // Trigger cleanup via server update
            client.applyServerUpdate([]);

            // Operation should be removed
            expect(client.getPendingCount()).toBe(0);
        });

        it('should keep operations within maxPendingAge', () => {
            const client = new ClientCollection<TodoShape>('todos', {
                maxPendingAge: 2000, // 2 seconds
            });

            const opId = createOperationId();

            // Create operation at t=0
            vi.setSystemTime(0);
            client.applyLocal([
                {
                    opId,
                    type: 'create',
                    item: {
                        id: createItemId(),
                        title: mutable('Recent item'),
                        completed: mutable(false),
                    },
                },
            ]);

            // Advance time but not past maxPendingAge
            vi.setSystemTime(1500);

            // Trigger cleanup
            client.applyServerUpdate([]);

            // Operation should still be there
            expect(client.getPendingCount()).toBe(1);
        });
    });

    describe('View Consistency', () => {
        it('should keep server state and current view in sync', () => {
            const client = new ClientCollection<TodoShape>('todos');
            const itemId = createItemId();

            // Server creates item
            client.applyServerUpdate([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutable('Server item'),
                        completed: mutable(false),
                    },
                },
            ]);

            const serverItems = client.readServerState();
            const viewItems = client.read();

            expect(serverItems).toHaveLength(1);
            expect(viewItems).toHaveLength(1);
            expect(serverItems[0].id).toBe(viewItems[0].id);
        });

        it('should show pending operations in current view but not server state', () => {
            const client = new ClientCollection<TodoShape>('todos');
            const itemId = createItemId();

            // Server creates item
            client.applyServerUpdate([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutable('Server item'),
                        completed: mutable(false),
                    },
                },
            ]);

            // User updates locally
            client.applyLocal([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: itemId,
                    changes: {
                        title: mutable('Local edit'),
                    },
                },
            ]);

            const serverItem = client.readServerState()[0];
            const viewItem = client.read()[0];

            expect(serverItem.title.value).toBe('Server item');
            expect(viewItem.title.value).toBe('Local edit');
        });
    });

    describe('Monotonic Ordering', () => {
        it('should maintain monotonic order even if time goes backwards', () => {
            const client = new ClientCollection<TodoShape>('todos');

            // Create operations
            const opId1 = createOperationId();
            const opId2 = createOperationId();
            const opId3 = createOperationId();

            client.applyLocal([
                {
                    opId: opId1,
                    type: 'create',
                    item: {
                        id: createItemId(),
                        title: mutable('First'),
                        completed: mutable(false),
                    },
                },
            ]);

            client.applyLocal([
                {
                    opId: opId2,
                    type: 'create',
                    item: {
                        id: createItemId(),
                        title: mutable('Second'),
                        completed: mutable(false),
                    },
                },
            ]);

            client.applyLocal([
                {
                    opId: opId3,
                    type: 'create',
                    item: {
                        id: createItemId(),
                        title: mutable('Third'),
                        completed: mutable(false),
                    },
                },
            ]);

            const metadata = client.getPendingMetadata();

            // Order times should be monotonically increasing
            expect(metadata[0].orderTime).toBeLessThan(metadata[1].orderTime);
            expect(metadata[1].orderTime).toBeLessThan(metadata[2].orderTime);

            // Operations should be in the order they were created
            expect(metadata[0].operation.opId).toBe(opId1);
            expect(metadata[1].operation.opId).toBe(opId2);
            expect(metadata[2].operation.opId).toBe(opId3);
        });
    });

    describe('Utility Methods', () => {
        it('should clear all pending operations', () => {
            const client = new ClientCollection<TodoShape>('todos');

            client.applyLocal([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: createItemId(),
                        title: mutable('Item 1'),
                        completed: mutable(false),
                    },
                },
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: createItemId(),
                        title: mutable('Item 2'),
                        completed: mutable(false),
                    },
                },
            ]);

            expect(client.getPendingCount()).toBe(2);

            client.clearPendingOperations();

            expect(client.getPendingCount()).toBe(0);
            expect(client.getPendingOperations()).toHaveLength(0);
        });

        it('should return pending operations sorted by order', () => {
            const client = new ClientCollection<TodoShape>('todos');

            const opId1 = createOperationId();
            const opId2 = createOperationId();
            const opId3 = createOperationId();

            // Create operations in specific order
            client.applyLocal([
                {
                    opId: opId2,
                    type: 'create',
                    item: {
                        id: createItemId(),
                        title: mutable('Second'),
                        completed: mutable(false),
                    },
                },
            ]);

            client.applyLocal([
                {
                    opId: opId1,
                    type: 'create',
                    item: {
                        id: createItemId(),
                        title: mutable('First'),
                        completed: mutable(false),
                    },
                },
            ]);

            client.applyLocal([
                {
                    opId: opId3,
                    type: 'create',
                    item: {
                        id: createItemId(),
                        title: mutable('Third'),
                        completed: mutable(false),
                    },
                },
            ]);

            const pending = client.getPendingOperations();
            expect(pending).toHaveLength(3);
            expect(pending[0].opId).toBe(opId2);
            expect(pending[1].opId).toBe(opId1);
            expect(pending[2].opId).toBe(opId3);
        });
    });

    describe('Complex Scenarios', () => {
        it('should handle interleaved local and server updates', () => {
            const client = new ClientCollection<TodoShape>('todos');
            const itemId = createItemId();

            // Server creates item
            client.applyServerUpdate([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        title: mutableAt('v1', 1000),
                        completed: mutableAt(false, 1000),
                    },
                },
            ]);

            // User edits locally (newer than server)
            client.applyLocal([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: itemId,
                    changes: {
                        title: mutableAt('v2-local', 2000),
                    },
                },
            ]);

            expect(client.readOne(itemId)?.title.value).toBe('v2-local');
            expect(client.getPendingCount()).toBe(1);

            // Server update with even newer version
            client.applyServerUpdate([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: itemId,
                    changes: {
                        title: mutableAt('v3-server', 3000),
                    },
                },
            ]);

            // Local edit gets removed because server has newer timestamp
            expect(client.readOne(itemId)?.title.value).toBe('v3-server');
            expect(client.getPendingCount()).toBe(0);

            // User makes another edit (with current timestamp, newer than server)
            client.applyLocal([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: itemId,
                    changes: {
                        title: mutable('v4-local'),
                    },
                },
            ]);

            expect(client.readOne(itemId)?.title.value).toBe('v4-local');
            expect(client.getPendingCount()).toBe(1);

            // Server confirms the latest edit
            client.applyServerUpdate([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: itemId,
                    changes: {
                        title: mutable('v4-local'),
                    },
                },
            ]);

            expect(client.getPendingCount()).toBe(0);
        });
    });
});
