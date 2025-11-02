/**
 * Type-level tests to ensure version is required when versioned=true
 */

import { describe, it, expect } from 'vitest';
import { defineSchema, type, field, type PartialServerUpdate } from '../index';

describe('Type Enforcement', () => {
    it('should require version field when versioned=true', () => {
        const schema = defineSchema({
            types: {
                todos: type({
                    fields: {
                        title: field<string>(),
                    },
                    versioned: true as const,
                }),
            }
        });

        type SchemaType = typeof schema._schema;
        type UpdateType = PartialServerUpdate<SchemaType>;

        // Extract the todo item type to inspect it
        type TodoItem = NonNullable<UpdateType['todos']>[number];

        // Type-level test: version should be required
        type VersionField = TodoItem extends { version: infer V } ? V : never;
        type IsVersionRequired = undefined extends VersionField ? false : true;

        // This compile-time assertion will fail if version is not required
        const _assertVersionRequired: IsVersionRequired = true as const;

        // Dummy test to make vitest happy
        expect(_assertVersionRequired).toBe(true);
    });

    it('should prohibit version field when versioned=false', () => {
        const schema = defineSchema({
            types: {
                settings: type({
                    fields: {
                        theme: field<string>(),
                    },
                    versioned: false as const,
                }),
            }
        });

        type SchemaType = typeof schema._schema;
        type UpdateType = PartialServerUpdate<SchemaType>;

        // When versioned=false, version should be prohibited
        // This should be valid - no version field
        const withoutVersion: UpdateType = {
            settings: [{
                id: 'settings-1',
                theme: 'light',
            }],
        };

        const withVersion: UpdateType = {
            settings: [{
                id: 'settings-1',
                // @ts-expect-error - version is prohibited when versioned=false
                version: 1,
                theme: 'dark',
            }],
        };

        expect(withoutVersion).toBeDefined();
        expect(withVersion).toBeDefined();
    });
});
