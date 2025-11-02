/**
 * Core types for the sync engine
 */

// ============================================================================
// Core Types - Item Identity and Structure
// ============================================================================

/**
 * Every item in the sync engine must have a unique identifier
 * using CUID2 format for distributed ID generation
 */
export type ItemId = string;

/**
 * Timestamp in milliseconds since epoch
 * Used to track when mutable fields were changed
 */
export type Timestamp = number;

/**
 * Unique identifier for a diff operation
 */
export type OperationId = string;

// ============================================================================
// Server-Side Representation (Internal)
// ============================================================================

/**
 * Field value wrapper with version for LWW conflict resolution
 * Used internally in server snapshots
 *
 * When trackUpdatedAt is disabled for a type, version will be 0
 */
export interface FieldValue<T> {
    /** The actual field value */
    value: T;
    /** Version number when this field was last updated (monotonically increasing) */
    version: number;
}

/**
 * Version number for objects and fields
 * Used to track update order and detect out-of-order updates
 * Monotonically increasing number
 */
export type Version = number;

// ============================================================================
// Persistence Types
// ============================================================================

/**
 * Serialized state format for persistence
 * Contains server snapshot and pending mutations needed to fully restore engine state
 *
 * The persisted data can be stringified and stored, then later used to restore
 * the sync engine to its exact state at the time of persistence.
 *
 * @typeParam T - The full schema definition
 */
export interface PersistedState<T> {
    /** Server snapshot with wrapped field values and versions */
    serverSnapshot: T;
    /** Pending mutations waiting for server confirmation */
    pendingMutations: unknown[];
}