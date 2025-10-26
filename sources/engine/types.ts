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