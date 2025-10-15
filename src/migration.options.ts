import { ModuleMetadata, Type } from "@nestjs/common";

/**
 * Configuration options for the MigrationsModule.
 * Defines database connection and module behavior settings.
 */
export interface MigrationsModuleOptions {
  /** MongoDB connection URI */
  uri: string;
  /** Database name for storing migrations (defaults to 'migrations') */
  dbName?: string;
  /** Collection name for storing migration metadata (defaults to 'migrations') */
  collectionName?: string;
  /** Whether to use direct MongoDB connection */
  directConnection?: boolean;
  /**
   * Automatically execute migrations during onApplicationBootstrap.
   * Set to false for manual control over when migrations run.
   */
  autoRunOnBootstrap?: boolean;
}

/**
 * Configuration options for individual migrations decorated with @Migration().
 * Controls execution behavior, scheduling, and metadata.
 */
export interface MigrationDecoratorOptions {
  /** Custom key for the migration (defaults to 'ServiceName.methodName') */
  key?: string;
  /** Execution order (lower numbers run first) */
  order?: number;
  /** Human-readable description of what the migration does */
  description?: string;
  /** Whether to retry failed migrations on app restart */
  retryOnFail?: boolean;
  /** Whether this migration should run during app initialization */
  runOnInit?: boolean;
  /** Whether this migration runs only once (false for recurring migrations) */
  runOnce?: boolean;
  /** Scheduling configuration for automated execution */
  schedule?: {
    /** One-off execution at specific date/time */
    at?: string | Date;
    /** Cron expression for recurring execution (requires @nestjs/schedule) */
    cron?: string;
    /** IANA timezone for cron schedules */
    timezone?: string;
  };
  /** Predicate function to conditionally run migration based on environment */
  shouldRun?: (env: NodeJS.ProcessEnv) => boolean | Promise<boolean>;
}

/**
 * Factory interface for creating migration options asynchronously.
 * Used with forRootAsync() configuration.
 */
export interface MigrationsOptionsFactory {
  createMigrationsOptions():
    | Promise<MigrationsModuleOptions>
    | MigrationsModuleOptions;
}

/**
 * Asynchronous configuration options for MigrationsModule.
 * Supports factory functions and dependency injection.
 */
export interface MigrationsModuleAsyncOptions
  extends Pick<ModuleMetadata, "imports"> {
  /** Use an existing provider as the options factory */
  useExisting?: Type<MigrationsOptionsFactory>;
  /** Use a class as the options factory */
  useClass?: Type<MigrationsOptionsFactory>;
  /** Use a factory function to create options */
  useFactory?: (
    ...args: any[]
  ) => Promise<MigrationsModuleOptions> | MigrationsModuleOptions;
  /** Dependencies to inject into the factory function */
  inject?: any[];
}
