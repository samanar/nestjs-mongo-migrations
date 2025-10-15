// libs/migrations/src/migration.module.ts
import {
  DynamicModule,
  Global,
  Inject,
  Module,
  OnApplicationBootstrap,
  Provider,
} from "@nestjs/common";
import { DiscoveryModule, Reflector } from "@nestjs/core";
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from "@nestjs/mongoose";
import { Connection } from "mongoose";

import { MigrationsService } from "./migration.service";
import {
  MIGRATIONS_CONNECTION,
  MIGRATIONS_OPTIONS,
} from "./migration.constants";
import {
  MigrationsModuleOptions,
  MigrationsModuleAsyncOptions,
  MigrationsOptionsFactory,
} from "./migration.options";
import { MigrationClass, MigrationSchema } from "./migration.schema";

/**
 * Global module that provides MongoDB migration capabilities for NestJS applications.
 * Manages the migration system lifecycle, database connections, and service registration.
 * Automatically discovers and executes migrations decorated with @Migration().
 */
@Global()
@Module({})
export class MigrationsModule implements OnApplicationBootstrap {
  constructor(
    private readonly svc: MigrationsService,
    @Inject(MIGRATIONS_OPTIONS) private readonly opts: MigrationsModuleOptions
  ) {}

  /**
   * Synchronous module configuration for static migration options.
   * Creates a separate MongoDB connection for storing migration metadata.
   *
   * @param options - Static configuration options
   * @returns Dynamic module configuration
   */
  static forRoot(options: MigrationsModuleOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: MIGRATIONS_OPTIONS,
      useValue: options,
    };
    return this.createDynamicModule([], [optionsProvider]);
  }

  /**
   * Asynchronous module configuration for dynamic migration options.
   * Useful when configuration depends on other services (e.g., ConfigService).
   *
   * @param options - Async configuration options with factory or class
   * @returns Dynamic module configuration
   */
  static forRootAsync(options: MigrationsModuleAsyncOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(options);
    return this.createDynamicModule(options.imports ?? [], asyncProviders);
  }

  /**
   * Shared builder used by both forRoot and forRootAsync methods.
   * Creates the complete dynamic module configuration with all necessary providers.
   *
   * @param extraImports - Additional modules to import
   * @param optionsProviders - Providers for the migration options
   * @returns Complete dynamic module configuration
   */
  private static createDynamicModule(
    extraImports: any[],
    optionsProviders: Provider[]
  ): DynamicModule {
    // Create a module to hold and export the options providers
    @Module({
      providers: [...optionsProviders],
      exports: [...optionsProviders],
    })
    class MigrationsOptionsModule {}

    // Create a separate MongoDB connection for migrations metadata
    const connectionImport = MongooseModule.forRootAsync({
      connectionName: MIGRATIONS_CONNECTION,
      imports: [MigrationsOptionsModule], // Make options available to factory
      inject: [MIGRATIONS_OPTIONS],
      useFactory: async (opts: MigrationsModuleOptions) => {
        return {
          uri: opts.uri,
          dbName: opts.dbName ?? "migrations",
          directConnection: opts.directConnection ?? false,
        };
      },
    });

    // Create the Migration model provider with configurable collection name
    const modelProvider: Provider = {
      provide: getModelToken(MigrationClass.name, MIGRATIONS_CONNECTION),
      useFactory: (conn: Connection, opts: MigrationsModuleOptions) =>
        conn.model(
          MigrationClass.name,
          MigrationSchema,
          opts.collectionName ?? "migrations"
        ),
      inject: [getConnectionToken(MIGRATIONS_CONNECTION), MIGRATIONS_OPTIONS],
    };

    // Conditionally provide SchedulerRegistry if @nestjs/schedule is available
    const schedulerProvider: Provider = {
      provide: "SchedulerRegistry",
      useFactory: () => {
        try {
          const { SchedulerRegistry } = require("@nestjs/schedule");
          return new SchedulerRegistry();
        } catch {
          return null; // Gracefully handle when package is not installed
        }
      },
    };

    return {
      module: MigrationsModule,
      imports: [
        DiscoveryModule,
        MigrationsOptionsModule,
        connectionImport,
        ...extraImports,
      ],
      providers: [
        Reflector,
        MigrationsService,
        modelProvider,
        schedulerProvider,
      ],
      exports: [MigrationsService],
    };
  }

  /**
   * Creates providers for asynchronous module configuration.
   * Handles both useFactory and useClass patterns for dynamic options.
   *
   * @param options - Async configuration options
   * @returns Array of providers for the async configuration
   */
  private static createAsyncProviders(
    options: MigrationsModuleAsyncOptions
  ): Provider[] {
    if (options.useFactory) {
      // Factory-based async configuration
      return [
        {
          provide: MIGRATIONS_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ];
    }

    // Class-based async configuration
    const useClass = options.useClass ?? options.useExisting!;
    const providers: Provider[] = [
      {
        provide: MIGRATIONS_OPTIONS,
        useFactory: async (factory: MigrationsOptionsFactory) =>
          factory.createMigrationsOptions(),
        inject: [useClass],
      },
    ];

    // Add the factory class as a provider if useClass is specified
    if (options.useClass) {
      providers.push({
        provide: useClass,
        useClass: useClass,
      });
    }

    return providers;
  }

  /**
   * Lifecycle hook that runs after the application has bootstrapped.
   * Triggers the migration discovery and execution process if auto-run is enabled.
   */
  async onApplicationBootstrap() {
    if (this.opts.autoRunOnBootstrap === false) {
      return;
    }
    await this.svc.initAndMaybeRun();
  }
}
