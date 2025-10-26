/**
 * Helper functions for the sync engine
 */

import { createId } from '@paralleldrive/cuid2';
import type { ItemId, OperationId, Timestamp, MutableField } from './types';

/**
 * Create a new item ID
 */
export function createItemId(): ItemId {
    return createId();
}

/**
 * Create a new operation ID
 */
export function createOperationId(): OperationId {
    return createId();
}

/**
 * Create a new mutable field with the given value
 */
export function mutable<T>(value: T | null): MutableField<T> {
    return {
        value,
        changedAt: Date.now()
    };
}

/**
 * Create a new mutable field with explicit timestamp
 * Useful when reconstructing fields from stored data
 */
export function mutableAt<T>(value: T | null, changedAt: Timestamp): MutableField<T> {
    return {
        value,
        changedAt
    };
}

/**
 * Update a mutable field only if the value changed
 */
export function updateMutable<T>(
    field: MutableField<T>,
    newValue: T | null
): MutableField<T> {
    if (field.value === newValue) {
        return field;
    }
    return {
        value: newValue,
        changedAt: Date.now()
    };
}
