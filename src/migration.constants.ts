export const MIGRATIONS_CONNECTION = 'MIGRATIONS_CONNECTION';
export const MIGRATIONS_OPTIONS = Symbol('MIGRATIONS_OPTIONS');
export const MIGRATION_META = 'custom:migration';

export type MigrationStatus = 'pending' | 'running' | 'applied' | 'failed';
