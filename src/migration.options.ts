import { ModuleMetadata, Type } from "@nestjs/common";

export interface MigrationsModuleOptions {
  uri: string;
  dbName?: string;
  collectionName?: string;
  directConnection?: boolean;
  /**
   * Automatically execute migrations during onApplicationBootstrap. Disable if you want manual control.
   */
  autoRunOnBootstrap?: boolean;
}

export interface MigrationDecoratorOptions {
  key?: string;
  order?: number;
  description?: string;
  retryOnFail?: boolean;
  runOnInit?: boolean;
  runOnce?: boolean;
  schedule?: {
    at?: string | Date; // one-off ISO date (or Date) for a single run
    cron?: string; // crontab expression (e.g. "0 3 * * *")
    timezone?: string; // e.g., "Europe/Berlin"
  };
  shouldRun?: (env: NodeJS.ProcessEnv) => boolean | Promise<boolean>;
}

export interface MigrationsOptionsFactory {
  createMigrationsOptions():
    | Promise<MigrationsModuleOptions>
    | MigrationsModuleOptions;
}

export interface MigrationsModuleAsyncOptions
  extends Pick<ModuleMetadata, "imports"> {
  useExisting?: Type<MigrationsOptionsFactory>;
  useClass?: Type<MigrationsOptionsFactory>;
  useFactory?: (
    ...args: any[]
  ) => Promise<MigrationsModuleOptions> | MigrationsModuleOptions;
  inject?: any[];
}
