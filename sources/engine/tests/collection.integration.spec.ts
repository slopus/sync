/**
 * Level 5: Integration Tests
 * Complex workflows and real-world scenarios
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

describe('Collection - Integration', () => {
    describe('Todo List Workflow', () => {
        it('should handle complete todo lifecycle', () => {
            const todos = new Collection<{
                createdAt: number;
                title: Mutable<string>;
                completed: Mutable<boolean>;
                description: Mutable<string>;
            }>('todos');

            // Create a todo
            const todoId = createItemId();
            todos.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: todoId,
                        createdAt: Date.now(),
                        title: mutable('Buy groceries'),
                        completed: mutable(false),
                        description: mutable('Milk, bread, eggs'),
                    },
                },
            ]);

            expect(todos.read()).toHaveLength(1);

            // Update the title
            todos.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: todoId,
                    changes: {
                        title: mutable('Buy groceries and vegetables'),
                    },
                },
            ]);

            const todo = todos.readOne(todoId);
            expect(todo?.title.value).toBe('Buy groceries and vegetables');

            // Mark as completed
            todos.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: todoId,
                    changes: {
                        completed: mutable(true),
                    },
                },
            ]);

            const completedTodo = todos.readOne(todoId);
            expect(completedTodo?.completed.value).toBe(true);

            // Delete the todo
            todos.applyDiff([
                { opId: createOperationId(), type: 'delete', id: todoId },
            ]);

            expect(todos.read()).toHaveLength(0);
        });
    });

    describe('Collaborative Editing Scenario', () => {
        it('should handle concurrent edits from multiple users', () => {
            const documents = new Collection<{
                title: Mutable<string>;
                content: Mutable<string>;
                author: Mutable<string>;
            }>('documents');

            const docId = createItemId();

            // User A creates document at t1
            documents.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: docId,
                        title: mutableAt('My Document', 1000),
                        content: mutableAt('Initial content', 1000),
                        author: mutableAt('User A', 1000),
                    },
                },
            ]);

            // User B edits title at t2
            const userBEdit = createOperationId();
            documents.applyDiff([
                {
                    opId: userBEdit,
                    type: 'update',
                    id: docId,
                    changes: {
                        title: mutableAt('Our Document', 2000),
                    },
                },
            ]);

            // User A edits content at t3 (after B's edit)
            documents.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: docId,
                    changes: {
                        content: mutableAt('Updated content by A', 3000),
                    },
                },
            ]);

            // User B edits content at t4 (last one wins)
            documents.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'update',
                    id: docId,
                    changes: {
                        content: mutableAt('Final content by B', 4000),
                    },
                },
            ]);

            const doc = documents.readOne(docId);
            expect(doc?.title.value).toBe('Our Document');
            expect(doc?.content.value).toBe('Final content by B');
            expect(doc?.author.value).toBe('User A');
        });
    });

    describe('Batch Operations', () => {
        it('should efficiently process large batches', () => {
            const collection = new Collection<{
                index: number;
                value: Mutable<string>;
            }>('items');

            // Create 100 items in one batch
            const createOps = Array.from({ length: 100 }, (_, i) => ({
                opId: createOperationId(),
                type: 'create' as const,
                item: {
                    id: createItemId(),
                    index: i,
                    value: mutable(`Item ${i}`),
                },
            }));

            const results = collection.applyDiff(createOps);

            // All should succeed
            const accepted = Array.from(results.values()).filter(r => r.accepted);
            expect(accepted).toHaveLength(100);
            expect(collection.read()).toHaveLength(100);
        });

        it('should handle mixed success and failures in batch', () => {
            const collection = new Collection<{
                value: Mutable<string>;
            }>('items');

            const existingId = createItemId();

            // Create one item
            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: { id: existingId, value: mutable('Exists') },
                },
            ]);

            // Batch with mix of valid and invalid ops
            const op1 = createOperationId();
            const op2 = createOperationId(); // Duplicate
            const op3 = createOperationId();
            const op4 = createOperationId(); // Update non-existent

            const results = collection.applyDiff([
                {
                    opId: op1,
                    type: 'create',
                    item: { id: createItemId(), value: mutable('New 1') },
                },
                {
                    opId: op2,
                    type: 'create',
                    item: { id: existingId, value: mutable('Duplicate') },
                },
                {
                    opId: op3,
                    type: 'create',
                    item: { id: createItemId(), value: mutable('New 2') },
                },
                {
                    opId: op4,
                    type: 'update',
                    id: 'fake-id',
                    changes: { value: mutable('Update') },
                },
            ]);

            expect(isAccepted(results, op1)).toBe(true);
            expect(isAccepted(results, op2)).toBe(false);
            expect(isAccepted(results, op3)).toBe(true);
            expect(isAccepted(results, op4)).toBe(false);

            // Should have 3 items total (1 existing + 2 new)
            expect(collection.read()).toHaveLength(3);
        });
    });

    describe('Synchronization Patterns', () => {
        it('should simulate offline-first sync', () => {
            const local = new Collection<{
                title: Mutable<string>;
            }>('local');

            const remote = new Collection<{
                title: Mutable<string>;
            }>('remote');

            const itemId = createItemId();

            // Initial sync - create on both
            const createOp = {
                opId: createOperationId(),
                type: 'create' as const,
                item: { id: itemId, title: mutableAt('Synced', 1000) },
            };

            local.applyDiff([createOp]);
            remote.applyDiff([createOp]);

            // Offline: local edit at t2
            const localEdit = {
                opId: createOperationId(),
                type: 'update' as const,
                id: itemId,
                changes: { title: mutableAt('Local Edit', 2000) },
            };
            local.applyDiff([localEdit]);

            // Meanwhile: remote edit at t3
            const remoteEdit = {
                opId: createOperationId(),
                type: 'update' as const,
                id: itemId,
                changes: { title: mutableAt('Remote Edit', 3000) },
            };
            remote.applyDiff([remoteEdit]);

            // Sync: apply remote to local
            local.applyDiff([remoteEdit]);

            // Sync: apply local to remote
            remote.applyDiff([localEdit]);

            // Both should converge to remote edit (newer timestamp)
            const localItem = local.readOne(itemId);
            const remoteItem = remote.readOne(itemId);

            expect(localItem?.title.value).toBe('Remote Edit');
            expect(remoteItem?.title.value).toBe('Remote Edit');
            expect(localItem?.title.changedAt).toBe(3000);
            expect(remoteItem?.title.changedAt).toBe(3000);
        });
    });

    describe('Complex Data Structures', () => {
        it('should handle items with mixed field types', () => {
            const collection = new Collection<{
                // Immutable fields
                id_copy: string;
                created_at: number;
                // Mutable primitive fields
                title: Mutable<string>;
                count: Mutable<number>;
                active: Mutable<boolean>;
                // Mutable nullable fields
                description: Mutable<string | null>;
                tags: Mutable<string[] | null>;
            }>('complex');

            const itemId = createItemId();

            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: {
                        id: itemId,
                        id_copy: itemId,
                        created_at: Date.now(),
                        title: mutable('Complex Item'),
                        count: mutable(42),
                        active: mutable(true),
                        description: mutable(null),
                        tags: mutable(['tag1', 'tag2']),
                    },
                },
            ]);

            const item = collection.readOne(itemId);
            expect(item?.title.value).toBe('Complex Item');
            expect(item?.count.value).toBe(42);
            expect(item?.active.value).toBe(true);
            expect(item?.description.value).toBeNull();
            expect(item?.tags.value).toEqual(['tag1', 'tag2']);
            expect(item?.id_copy).toBe(itemId);
            expect(typeof item?.created_at).toBe('number');
        });
    });
});
