/**
 * Collection implementation for the sync engine
 */

import type {
    ItemId,
    Timestamp,
    MutableField,
    Item,
    CollectionState,
    OperationId,
    DiffOperation,
    Diff,
    OperationResult,
    DiffResult,
} from './types';

/**
 * A Collection manages a set of items with automatic change tracking
 * and synchronization support.
 *
 * Operations:
 * 1. read() - Get current items
 * 2. applyDiff() - Apply changes to the collection
 */
export class Collection<TShape> {
    private state: CollectionState<TShape>;
    public readonly name: string;

    constructor(name: string) {
        this.name = name;
        this.state = new Map();
    }

    /**
     * Read all items in the collection
     */
    read(): Item<TShape>[] {
        return Array.from(this.state.values());
    }

    /**
     * Read a specific item by ID
     */
    readOne(id: ItemId): Item<TShape> | undefined {
        return this.state.get(id);
    }

    /**
     * Apply a diff to the collection
     * Returns a map of operation IDs to their results (accepted/rejected with reason)
     * Operations can be in any order and are processed independently
     * Timestamps are clamped to "now" - cannot write to the future
     */
    applyDiff(diff: Diff<TShape>): DiffResult {
        const results = new Map<OperationId, OperationResult>();
        const now = Date.now();

        for (const operation of diff) {
            const result = this.applyOperation(operation, now);
            results.set(operation.opId, result);
        }

        return results;
    }

    /**
     * Apply a single operation and return its result
     */
    private applyOperation(operation: DiffOperation<TShape>, now: Timestamp): OperationResult {
        switch (operation.type) {
            case 'create': {
                if (this.state.has(operation.item.id)) {
                    return {
                        accepted: false,
                        reason: 'Item with this ID already exists',
                    };
                }

                // Validate and clamp timestamps in the item
                const validationResult = this.validateAndClampItem(operation.item, now);
                if (!validationResult.valid) {
                    return {
                        accepted: false,
                        reason: validationResult.reason,
                    };
                }

                this.state.set(operation.item.id, validationResult.item);
                return { accepted: true };
            }

            case 'update': {
                const existing = this.state.get(operation.id);
                if (!existing) {
                    return {
                        accepted: false,
                        reason: 'Item not found',
                    };
                }

                // Validate and clamp timestamps in changes
                const validationResult = this.validateAndClampChanges(operation.changes, now);
                if (!validationResult.valid) {
                    return {
                        accepted: false,
                        reason: validationResult.reason,
                    };
                }

                const updated = this.mergeChanges(existing, validationResult.changes, now);
                if (updated === existing) {
                    return {
                        accepted: false,
                        reason: 'No changes to apply',
                    };
                }

                this.state.set(operation.id, updated);
                return { accepted: true };
            }

            case 'delete': {
                if (!this.state.has(operation.id)) {
                    return {
                        accepted: false,
                        reason: 'Item not found',
                    };
                }

                this.state.delete(operation.id);
                return { accepted: true };
            }
        }
    }

    /**
     * Validate and clamp timestamps in an item
     * Ensures no timestamps are in the future
     */
    private validateAndClampItem(
        item: Item<TShape>,
        now: Timestamp
    ): { valid: true; item: Item<TShape> } | { valid: false; reason: string } {
        const clampedItem: Record<string, unknown> = { ...item };
        let hasChanges = false;

        for (const [key, value] of Object.entries(item)) {
            if (this.isMutableField(value)) {
                const field = value as MutableField<unknown>;
                if (field.changedAt > now) {
                    // Clamp to now
                    clampedItem[key] = {
                        value: field.value,
                        changedAt: now,
                    };
                    hasChanges = true;
                }
            }
        }

        return {
            valid: true,
            item: hasChanges ? (clampedItem as Item<TShape>) : item,
        };
    }

    /**
     * Validate and clamp timestamps in changes
     */
    private validateAndClampChanges(
        changes: Partial<TShape>,
        now: Timestamp
    ): { valid: true; changes: Partial<TShape> } | { valid: false; reason: string } {
        const clampedChanges: Record<string, unknown> = { ...changes };
        let hasChanges = false;

        for (const [key, value] of Object.entries(changes)) {
            if (this.isMutableField(value)) {
                const field = value as MutableField<unknown>;
                if (field.changedAt > now) {
                    // Clamp to now
                    clampedChanges[key] = {
                        value: field.value,
                        changedAt: now,
                    };
                    hasChanges = true;
                }
            }
        }

        return {
            valid: true,
            changes: hasChanges ? (clampedChanges as Partial<TShape>) : changes,
        };
    }

    /**
     * Merge changes into an existing item, respecting mutable field semantics
     * Uses Last-Write-Wins (LWW) conflict resolution based on changedAt timestamps
     */
    private mergeChanges(
        existing: Item<TShape>,
        changes: Partial<TShape>,
        now: Timestamp
    ): Item<TShape> {
        let hasChanges = false;
        const updated: Record<string, unknown> = { ...existing };

        for (const [key, value] of Object.entries(changes)) {
            const existingValue = (existing as Record<string, unknown>)[key];

            // Check if this is a mutable field
            if (this.isMutableField(existingValue)) {
                const incomingField = value as MutableField<unknown>;
                const existingField = existingValue as MutableField<unknown>;

                // Last-Write-Wins: only apply if incoming timestamp is newer
                if (incomingField.changedAt > existingField.changedAt) {
                    // Apply the change with the incoming timestamp
                    updated[key] = {
                        value: incomingField.value,
                        changedAt: incomingField.changedAt,
                    };
                    hasChanges = true;
                } else if (incomingField.changedAt === existingField.changedAt) {
                    // Same timestamp - check if value actually differs
                    if (!this.deepEqual(incomingField.value, existingField.value)) {
                        // Conflict: same timestamp, different values
                        // Use incoming value but update timestamp to now
                        updated[key] = {
                            value: incomingField.value,
                            changedAt: now,
                        };
                        hasChanges = true;
                    }
                }
                // If incoming timestamp is older, keep existing (don't update)
            } else {
                // Immutable field - only update if different
                if (!this.deepEqual(value, existingValue)) {
                    updated[key] = value;
                    hasChanges = true;
                }
            }
        }

        return hasChanges ? (updated as Item<TShape>) : existing;
    }

    /**
     * Check if a value is a mutable field
     */
    private isMutableField(value: unknown): value is MutableField<unknown> {
        return (
            typeof value === 'object' &&
            value !== null &&
            'value' in value &&
            'changedAt' in value &&
            typeof (value as MutableField<unknown>).changedAt === 'number'
        );
    }

    /**
     * Deep equality check for values
     */
    private deepEqual(a: unknown, b: unknown): boolean {
        if (a === b) return true;
        if (a == null || b == null) return false;
        if (typeof a !== 'object' || typeof b !== 'object') return false;

        const keysA = Object.keys(a);
        const keysB = Object.keys(b);

        if (keysA.length !== keysB.length) return false;

        for (const key of keysA) {
            if (!keysB.includes(key)) return false;
            if (!this.deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
                return false;
            }
        }

        return true;
    }
}
