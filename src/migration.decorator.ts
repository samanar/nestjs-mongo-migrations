import 'reflect-metadata';
import { SetMetadata } from '@nestjs/common';
import { MIGRATION_META } from './migration.constants';
import { MigrationDecoratorOptions } from './migration.options';

export const Migration = (options?: MigrationDecoratorOptions) =>
  SetMetadata(MIGRATION_META, {
    order: options?.order ?? 0,
    runOnce: options?.runOnce ?? true,
    key: options?.key,
    retryOnFail: options?.retryOnFail ?? true,
    description: options?.description,
    runOnInit: options?.runOnInit,
  } as MigrationDecoratorOptions);
