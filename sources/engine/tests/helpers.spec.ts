/**
 * Level 1: Basic Helper Functions
 * Tests for ID generation and mutable field utilities
 */

import { describe, it, expect } from 'vitest';
import {
    createItemId,
    createOperationId,
    mutable,
    mutableAt,
    updateMutable,
} from '../index';

describe('Helper Functions', () => {
    describe('ID Generation', () => {
        it('should create unique item IDs', () => {
            const id1 = createItemId();
            const id2 = createItemId();

            expect(id1).not.toBe(id2);
            expect(typeof id1).toBe('string');
            expect(id1.length).toBeGreaterThan(0);
        });

        it('should create unique operation IDs', () => {
            const id1 = createOperationId();
            const id2 = createOperationId();

            expect(id1).not.toBe(id2);
            expect(typeof id1).toBe('string');
            expect(id1.length).toBeGreaterThan(0);
        });
    });

    describe('Mutable Field Creation', () => {
        it('should create mutable fields with current timestamp', () => {
            const field = mutable('test');

            expect(field.value).toBe('test');
            expect(typeof field.changedAt).toBe('number');
            expect(field.changedAt).toBeGreaterThan(0);
            expect(field.changedAt).toBeLessThanOrEqual(Date.now());
        });

        it('should create mutable fields with explicit timestamp', () => {
            const timestamp = 1234567890;
            const field = mutableAt('test', timestamp);

            expect(field.value).toBe('test');
            expect(field.changedAt).toBe(timestamp);
        });

        it('should create mutable fields with null values', () => {
            const field1 = mutable(null);
            const field2 = mutableAt(null, 1000);

            expect(field1.value).toBeNull();
            expect(field2.value).toBeNull();
        });
    });

    describe('Mutable Field Updates', () => {
        it('should return same reference when value unchanged', () => {
            const field1 = mutable('test');
            const field2 = updateMutable(field1, 'test');

            expect(field2).toBe(field1); // Same reference
            expect(field2.changedAt).toBe(field1.changedAt);
        });

        it('should return new reference when value changes', () => {
            const field1 = mutable('test');
            const field2 = updateMutable(field1, 'changed');

            expect(field2).not.toBe(field1); // Different reference
            expect(field2.value).toBe('changed');
            expect(field2.changedAt).toBeGreaterThanOrEqual(field1.changedAt);
        });

        it('should handle null value transitions', () => {
            const field1 = mutable<string>('test');
            const field2 = updateMutable(field1, null);
            const field3 = updateMutable(field2, 'back');

            expect(field2.value).toBeNull();
            expect(field3.value).toBe('back');
        });
    });
});
