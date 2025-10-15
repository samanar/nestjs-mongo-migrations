/**
 * Constants used throughout the migration system.
 * These provide consistent naming for dependency injection tokens and metadata keys.
 */

/** Name of the separate MongoDB connection used for storing migration metadata */
export const MIGRATIONS_CONNECTION = "MIGRATIONS_CONNECTION";

/** Dependency injection token for migration module options */
export const MIGRATIONS_OPTIONS = Symbol("MIGRATIONS_OPTIONS");

/** Metadata key used by the @Migration decorator for reflection */
export const MIGRATION_META = "custom:migration";

/** Possible states of a migration during its lifecycle */
export type MigrationStatus = "pending" | "running" | "applied" | "failed";
