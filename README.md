# nestjs-mongo-migrations

NestJS module that discovers methods decorated with `@Migration()` and coordinates MongoDB data migrations with Mongoose – including ordering, retries, and optional scheduling.

## Why this library?

- Automatically discovers migration methods across your NestJS providers.
- Persists migration state in MongoDB to prevent duplicate executions.
- Supports `runOnce`, retry-on-error, and cron/one-off scheduling.
- Integrates with `@nestjs/schedule` so you can run recurring clean-up or sync jobs.


## Quick start

1. **Import the module** – choose `forRoot` for static configuration or `forRootAsync` if you need DI.

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MongooseModule } from '@nestjs/mongoose';
import { MigrationsModule } from 'nestjs-mongo-migrations';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forRoot('mongodb://localhost:27017/my-app'),
    MigrationsModule.forRoot({
      uri: 'mongodb://localhost:27017/my-app',
      dbName: 'my-app',
      collectionName: 'migrations', // optional
      runOnInit: true,               // optional
    }),
  ],
})
export class AppModule {}
```

## Async configuration example

```ts
MigrationsModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: async (config: ConfigService) => ({
    uri: config.getOrThrow('MONGO_URI'),
    dbName: config.get('MIGRATIONS_DB', 'migrations'),
    runOnInit: config.get('RUN_MIGRATIONS_ON_BOOT', true),
  }),
});
```

2. **Create a migration** – decorate a provider method with `@Migration()`.

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
  async backfillSlugs() {
    await this.users.updateMany(
      { slug: { $exists: false } },
      [{ $set: { slug: { $concat: ['user-', '$_id'] } } }],
    );
  }
}
```

3. **Start your NestJS app** – the module will:

- Ensure the migrations collection exists.
- Discover every `@Migration` method.
- Persist metadata in MongoDB.
- Execute pending migrations in order (and schedule recurring ones).

## Decorator options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `key` | `<Service>.<method>` | Override the stored identifier. |
| `order` | `0` | Lower numbers run first. |
| `runOnce` | `true` | If `false`, the migration may run multiple times (e.g. cron). |
| `runOnInit` | `true` | Disable to register but skip automatic execution. |
| `retryOnFail` | `true` | Attempt again when the app restarts. |
| `description` | `undefined` | Helpful text stored alongside the migration. |
| `schedule.at` | `undefined` | ISO date (string or `Date`) for a one-off execution in the future. |
| `schedule.cron` | `undefined` | Cron expression processed by `cron`. |
| `schedule.timezone` | `undefined` | IANA time zone for cron schedules. |
| `shouldRun` | `undefined` | Async/Sync predicate leveraging `process.env`. |



## Development

- Build the library before publishing:

  ```bash
  npm run build
  ```

- Clean the generated output:

  ```bash
  npm run clean
  ```

`npm run build` compiles TypeScript to `dist/` and generates declaration files so the package is ready for `npm publish`.

## Publishing checklist

- Update the `version` in `package.json`.
- Run `npm install` to refresh the lockfile (optional but recommended).
- Execute `npm run build`.
- Confirm `dist/` contains the compiled files.
- Run `npm publish --access public`.

## License

MIT © Contributors
