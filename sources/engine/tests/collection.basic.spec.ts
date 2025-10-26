/**
 * Level 2: Basic Collection Operations
 * Tests for CRUD operations (Create, Read, Update, Delete)
 */

import { describe, it, expect } from 'vitest';
import {
    Collection,
    createItemId,
    createOperationId,
    mutable,
    type Mutable,
    type Diff,
} from '../index';
import { isAccepted, getReason } from './test-helpers';

describe('Collection - Basic Operations', () => {
    describe('Collection Creation', () => {
        it('should create a collection with a name', () => {
            const collection = new Collection<{}>('todos');

            expect(collection.name).toBe('todos');
        });

        it('should start with empty state', () => {
            const collection = new Collection<{}>('todos');

            expect(collection.read()).toEqual([]);
        });
    });

    describe('Create Operations', () => {
        it('should create a single item', () => {
            const collection = new Collection<{ title: Mutable<string> }>('todos');

            const item = {
                id: createItemId(),
                title: mutable('Buy milk'),
            };

            const opId = createOperationId();
            const results = collection.applyDiff([
                { opId, type: 'create', item },
            ]);

            expect(isAccepted(results, opId)).toBe(true);

            const items = collection.read();
            expect(items).toHaveLength(1);
            expect(items[0].id).toBe(item.id);
            expect(items[0].title.value).toBe('Buy milk');
        });

        it('should create multiple items', () => {
            const collection = new Collection<{ title: Mutable<string> }>('todos');

            const op1 = createOperationId();
            const op2 = createOperationId();

            const results = collection.applyDiff([
                {
                    opId: op1,
                    type: 'create',
                    item: { id: createItemId(), title: mutable('Item 1') }
                },
                {
                    opId: op2,
                    type: 'create',
                    item: { id: createItemId(), title: mutable('Item 2') }
                },
            ]);

            expect(isAccepted(results, op1)).toBe(true);
            expect(isAccepted(results, op2)).toBe(true);
            expect(collection.read()).toHaveLength(2);
        });

        it('should reject duplicate item IDs', () => {
            const collection = new Collection<{ title: Mutable<string> }>('todos');

            const item = {
                id: createItemId(),
                title: mutable('Buy milk'),
            };

            const op1 = createOperationId();
            const op2 = createOperationId();

            const results1 = collection.applyDiff([{ opId: op1, type: 'create', item }]);
            expect(isAccepted(results1, op1)).toBe(true);

            const results2 = collection.applyDiff([{ opId: op2, type: 'create', item }]);
            expect(isAccepted(results2, op2)).toBe(false);
            expect(getReason(results2, op2)).toBe('Item with this ID already exists');

            expect(collection.read()).toHaveLength(1);
        });
    });

    describe('Read Operations', () => {
        it('should read all items', () => {
            const collection = new Collection<{ title: Mutable<string> }>('todos');

            const id1 = createItemId();
            const id2 = createItemId();

            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: { id: id1, title: mutable('Item 1') }
                },
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: { id: id2, title: mutable('Item 2') }
                },
            ]);

            const items = collection.read();
            expect(items).toHaveLength(2);
            expect(items.map(i => i.id)).toContain(id1);
            expect(items.map(i => i.id)).toContain(id2);
        });

        it('should read a specific item by ID', () => {
            const collection = new Collection<{ title: Mutable<string> }>('todos');

            const itemId = createItemId();
            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: { id: itemId, title: mutable('Buy milk') }
                },
            ]);

            const item = collection.readOne(itemId);
            expect(item?.id).toBe(itemId);
            expect(item?.title.value).toBe('Buy milk');
        });

        it('should return undefined for non-existent items', () => {
            const collection = new Collection<{ title: Mutable<string> }>('todos');

            const item = collection.readOne('non-existent-id');
            expect(item).toBeUndefined();
        });
    });

    describe('Update Operations', () => {
        it('should update an existing item', () => {
            const collection = new Collection<{ title: Mutable<string> }>('todos');

            const itemId = createItemId();

            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: { id: itemId, title: mutable('Buy milk') }
                },
            ]);

            const updateOp = createOperationId();
            const results = collection.applyDiff([
                {
                    opId: updateOp,
                    type: 'update',
                    id: itemId,
                    changes: { title: mutable('Buy bread') },
                },
            ]);

            expect(isAccepted(results, updateOp)).toBe(true);

            const updated = collection.readOne(itemId);
            expect(updated?.title.value).toBe('Buy bread');
        });

        it('should reject updates to non-existent items', () => {
            const collection = new Collection<{ title: Mutable<string> }>('todos');

            const fakeId = createItemId();
            const updateOp = createOperationId();

            const results = collection.applyDiff([
                {
                    opId: updateOp,
                    type: 'update',
                    id: fakeId,
                    changes: { title: mutable('Test') },
                },
            ]);

            expect(isAccepted(results, updateOp)).toBe(false);
            expect(getReason(results, updateOp)).toBe('Item not found');
        });
    });

    describe('Delete Operations', () => {
        it('should delete an existing item', () => {
            const collection = new Collection<{ title: Mutable<string> }>('todos');

            const itemId = createItemId();

            collection.applyDiff([
                {
                    opId: createOperationId(),
                    type: 'create',
                    item: { id: itemId, title: mutable('Buy milk') }
                },
            ]);

            collection.applyDiff([
                { opId: createOperationId(), type: 'delete', id: itemId },
            ]);

            expect(collection.read()).toHaveLength(0);
            expect(collection.readOne(itemId)).toBeUndefined();
        });

        it('should reject deletes of non-existent items', () => {
            const collection = new Collection<{ title: Mutable<string> }>('todos');

            const fakeId = createItemId();
            const deleteOp = createOperationId();

            const results = collection.applyDiff([
                { opId: deleteOp, type: 'delete', id: fakeId },
            ]);

            expect(isAccepted(results, deleteOp)).toBe(false);
            expect(getReason(results, deleteOp)).toBe('Item not found');
        });
    });
});
