# nestjs-mongo-migrations

A NestJS module that discovers `@Migration()`-decorated methods, stores their state in MongoDB, and coordinates one-off or recurring data fixes without writing boilerplate orchestration code.

## Highlights

- Auto-discovers migration methods across your providers and keeps execution order deterministic.
- Persists status, errors, and run metadata in MongoDB so migrations execute exactly once unless you opt into repeats.
- Supports one-time runs, retries, and recurring schedules while gracefully degrading if scheduling packages are absent.
- Uses Nest's `MigrationsService` to orchestrate migrations automatically on bootstrap or manually when you prefer.
- Works alongside your primary Mongoose connection without blocking application startup.

## Installation

- Add the library to your Nest workspace:

  ```bash
  npm install nestjs-mongo-migrations
  ```

- Optional scheduling support: if you want `schedule.at` or `schedule.cron` to use Nest's scheduler, also install the scheduler packages your app already depends on:

  ```bash
  npm install @nestjs/schedule cron
  ```

  When these packages are missing the module falls back automatically—one-off schedules run immediately and cron schedules are skipped with a warning.

## Configure the module

Most projects can configure the module statically.

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { MigrationsModule } from 'nestjs-mongo-migrations';

@Module({
  imports: [
    MongooseModule.forRoot('mongodb://localhost:27017/app'),
    ScheduleModule.forRoot(), // optional, only if you installed @nestjs/schedule and you want to use croned or scheduled migrations
    MigrationsModule.forRoot({
      uri: 'mongodb://localhost:27017/app',
      dbName: 'migrations',         // defaults to "migrations"
      directConnection: false,      // forward to Mongoose when needed
      autoRunOnBootstrap: true,     // run migrations during onApplicationBootstrap
    }),
  ],
})
export class AppModule {}
```

Need configuration at runtime? Use `forRootAsync` to pull values from other providers.

```ts
MigrationsModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: async (config: ConfigService) => ({
    uri: config.getOrThrow<string>('MONGO_URI'),
    dbName: config.get<string>('MIGRATIONS_DB', 'migrations'),
    collectionName: config.get<string>('MIGRATIONS_COLLECTION'),
    autoRunOnBootstrap: config.get<boolean>('RUN_MIGRATIONS', true),
  }),
});
```

## Create migrations

Decorate provider methods with `@Migration()` to register and describe what should run.

```ts
// users-cleanup.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Migration } from 'nestjs-mongo-migrations';

@Injectable()
export class UsersCleanupService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  @Migration({
    order: 10,
    description: 'Backfill missing profile slugs',
    retryOnFail: true,
    runOnce: true,
  })
  async backfillSlugs(): Promise<void> {
    await this.users.updateMany(
      { slug: { $exists: false } },
      [{ $set: { slug: { $concat: ['user-', '$_id'] } } }],
    );
  }

  @Migration({
    key: 'users.cleanup.cron',
    runOnce: false,
    schedule: { cron: '0 3 * * *', timezone: 'UTC' },
    shouldRun: (env) => env.NODE_ENV === 'production',
  })
  async tidyInactiveAccounts(): Promise<void> {
    await this.users.deleteMany({ active: false, updatedAt: { $lt: new Date(Date.now() - 30 * 864e5) } });
  }
}
```

When the application boots the module:

- Ensures the migrations collection exists (defaults to `migrations`).
- Discovers decorated methods, writes their metadata to MongoDB, and tracks status (`pending`, `running`, `applied`, `failed`).
- Executes pending migrations in order, skipping ones whose `shouldRun` predicate returns `false`.
- Schedules recurring or one-off executions when scheduler dependencies exist.

## Working with the scheduler

- The module dynamically imports `@nestjs/schedule` and `cron`. If they are available, it uses a `SchedulerRegistry` to register timeouts and cron jobs.
- Without those packages, nothing crashes: one-off `schedule.at` migrations are executed immediately and cron-based migrations are registered as skipped with a warning in the Nest logger.
- To enable recurring runs, install the optional packages and import `ScheduleModule.forRoot()` once in your app (as in the earlier example).

## Manual execution flow

Automatic execution happens during `onApplicationBootstrap` when `autoRunOnBootstrap` is `true` (the default). For full control set it to `false` and trigger migrations after your app is ready.

```ts
// main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);

  const migrations = app.get(MigrationsService, { strict: false });
  await migrations.initAndMaybeRun();
}
bootstrap();
```

`initAndMaybeRun()` performs collection initialization, discovery, registration, and execution in one call.

## Module options

| Option | Default | Notes |
| ------ | ------- | ----- |
| `uri` | — | Connection string used for the dedicated migrations connection. |
| `dbName` | `"migrations"` | Database name for the connection. |
| `collectionName` | `"migrations"` | Mongo collection that stores migration documents. |
| `directConnection` | `false` | Passed through to the underlying Mongoose connection. |
| `autoRunOnBootstrap` | `true` | Toggle automatic execution during Nest bootstrap. |

## Decorator options

| Option | Default | Notes |
| ------ | ------- | ----- |
| `key` | `<Service>.<method>` | Override the unique identifier stored in MongoDB. |
| `order` | `0` | Lower numbers run first; ties execute in discovery order. |
| `description` | `undefined` | Helpful text stored with the migration document. |
| `retryOnFail` | `true` | Failed migrations are marked `failed` and retried on next bootstrap. |
| `runOnInit` | `true` | Set to `false` to register but skip automatic execution. |
| `runOnce` | `true` | Leave `false` when you plan to run on a schedule. |
| `schedule.at` | `undefined` | ISO 8601 string or `Date` for a single delayed run. |
| `schedule.cron` | `undefined` | Cron expression for recurring executions (`cron` package syntax). |
| `schedule.timezone` | `undefined` | IANA timezone name applied to the cron job. |
| `shouldRun` | `undefined` | Optional predicate (sync or async) that can short-circuit execution based on environment variables. |

## Stored documents

Each migration is persisted with its key, the containing service and method name, metadata, current `status`, `lastRunAt`, and an `error` message if the previous attempt failed. This lets you audit what ran and safely coordinate multiple Nest instances sharing the same MongoDB deployment.

## Development

- Build before publishing:

  ```bash
  npm run build
  ```

- Clean generated output:

  ```bash
  npm run clean
  ```

`npm run build` compiles TypeScript to `dist/` and generates declaration files so the package is ready for `npm publish`.

## Publishing checklist

- Update the version in `package.json`.
- Run `npm install` to refresh the lockfile (optional but recommended).
- Execute `npm run build`.
- Confirm `dist/` contains the compiled files.
