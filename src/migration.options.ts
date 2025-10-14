import { ModuleMetadata, Type } from '@nestjs/common';

export interface MigrationsModuleOptions {
  uri: string;
  dbName?: string;
  collectionName?: string;
  directConnection?: boolean;
  runOnInit?: boolean;
}

export interface MigrationDecoratorOptions {
  key?: string;
  order?: number;
  description?: string;
  retryOnFail?: boolean;
  runOnInit?: boolean;
  runOnce?: boolean;
}

export interface MigrationsOptionsFactory {
  createMigrationsOptions():
    | Promise<MigrationsModuleOptions>
    | MigrationsModuleOptions;
}

export interface MigrationsModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  useExisting?: Type<MigrationsOptionsFactory>;
  useClass?: Type<MigrationsOptionsFactory>;
  useFactory?: (
    ...args: any[]
  ) => Promise<MigrationsModuleOptions> | MigrationsModuleOptions;
  inject?: any[];
}
