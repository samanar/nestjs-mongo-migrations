// libs/migrations/src/migration.module.ts
import {
  DynamicModule,
  Global,
  Inject,
  Module,
  OnApplicationBootstrap,
  Provider,
} from '@nestjs/common';
import { DiscoveryModule, Reflector } from '@nestjs/core';
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { Connection } from 'mongoose';

import { MigrationsService } from './migration.service';
import {
  MIGRATIONS_CONNECTION,
  MIGRATIONS_OPTIONS,
} from './migration.constants';
import {
  MigrationsModuleOptions,
  MigrationsModuleAsyncOptions,
  MigrationsOptionsFactory,
} from './migration.options';
import { MigrationClass, MigrationSchema } from './migration.schema';

@Global()
@Module({})
export class MigrationsModule implements OnApplicationBootstrap {
  constructor(
    private readonly svc: MigrationsService,
    @Inject(MIGRATIONS_OPTIONS) private readonly opts: MigrationsModuleOptions,
  ) {}

  /** Synchronous setup */
  static forRoot(options: MigrationsModuleOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: MIGRATIONS_OPTIONS,
      useValue: options,
    };
    return this.createDynamicModule([], [optionsProvider]);
  }

  /** Asynchronous setup */
  static forRootAsync(options: MigrationsModuleAsyncOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(options);
    return this.createDynamicModule(options.imports ?? [], asyncProviders);
  }

  /** Shared builder used by both forRoot and forRootAsync */
  private static createDynamicModule(
    extraImports: any[],
    optionsProviders: Provider[],
  ): DynamicModule {
    // Wrap options providers in their own module so they are importable/exportable
    @Module({
      providers: [...optionsProviders],
      exports: [...optionsProviders],
    })
    class MigrationsOptionsModule {}

    const connectionImport = MongooseModule.forRootAsync({
      connectionName: MIGRATIONS_CONNECTION,
      // Make MIGRATIONS_OPTIONS visible to MongooseCoreModule's factory
      imports: [MigrationsOptionsModule],
      inject: [MIGRATIONS_OPTIONS],
      useFactory: async (opts: MigrationsModuleOptions) => {
        return {
          uri: opts.uri,
          dbName: opts.dbName ?? 'migrations',
          directConnection: opts.directConnection ?? false,
        };
      },
    });

    // Model provider so we can set collection name from options (works sync & async)
    const modelProvider: Provider = {
      provide: getModelToken(MigrationClass.name, MIGRATIONS_CONNECTION),
      useFactory: (conn: Connection, opts: MigrationsModuleOptions) =>
        conn.model(
          MigrationClass.name,
          MigrationSchema,
          opts.collectionName ?? 'migrations',
        ),
      inject: [getConnectionToken(MIGRATIONS_CONNECTION), MIGRATIONS_OPTIONS],
    };

    return {
      module: MigrationsModule,
      imports: [
        DiscoveryModule,
        MigrationsOptionsModule,
        connectionImport,
        ...extraImports,
      ],
      providers: [Reflector, MigrationsService, modelProvider],
      exports: [MigrationsService],
    };
  }

  private static createAsyncProviders(
    options: MigrationsModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: MIGRATIONS_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ];
    }

    const useClass = options.useClass ?? options.useExisting!;
    const providers: Provider[] = [
      {
        provide: MIGRATIONS_OPTIONS,
        useFactory: async (factory: MigrationsOptionsFactory) =>
          factory.createMigrationsOptions(),
        inject: [useClass],
      },
    ];

    if (options.useClass) {
      providers.push({
        provide: useClass,
        useClass: useClass,
      });
    }

    return providers;
  }

  async onApplicationBootstrap() {
    if (this.opts.autoRunOnBootstrap === false) {
      return;
    }
    await this.svc.initAndMaybeRun();
  }
}
