import "reflect-metadata";
import { SetMetadata } from "@nestjs/common";
import { MIGRATION_META } from "./migration.constants";
import { MigrationDecoratorOptions } from "./migration.options";

/**
 * Decorator that marks a method as a database migration.
 * The decorated method will be automatically discovered and executed by the migration system.
 *
 * @param options - Configuration options for the migration
 * @returns Method decorator
 *
 * @example
 * ```typescript
 * @Migration({
 *   order: 10,
 *   description: 'Backfill missing user slugs',
 *   retryOnFail: true,
 *   schedule: { cron: '0 3 * * *' } // Daily at 3am
 * })
 * async backfillSlugs() {
 *   // Migration logic here
 * }
 * ```
 */
export const Migration = (options?: MigrationDecoratorOptions) =>
  SetMetadata(MIGRATION_META, {
    order: options?.order ?? 0,
    runOnce: options?.runOnce ?? true,
    key: options?.key,
    retryOnFail: options?.retryOnFail ?? true,
    description: options?.description,
    runOnInit: options?.runOnInit,
    schedule: options?.schedule,
    shouldRun: options?.shouldRun,
  } as MigrationDecoratorOptions);
