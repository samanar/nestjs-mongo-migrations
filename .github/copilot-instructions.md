# NestJS MongoDB Migrations - AI Coding Guidelines

## Architecture Overview

This is a NestJS module that provides MongoDB data migration capabilities using Mongoose. The system automatically discovers methods decorated with `@Migration()` and orchestrates their execution with ordering, retry logic, and optional scheduling.

**Core Components:**

- `MigrationModule`: Global module managing the migration system and Mongoose connection
- `MigrationService`: Discovers, registers, and executes migrations using reflection
- `@Migration()` decorator: Marks methods as migrations with configurable options
- `MigrationSchema`: MongoDB document tracking migration state and metadata

**Key Design Patterns:**

- **Reflection-based Discovery**: Uses NestJS `DiscoveryModule` to scan providers for decorated methods
- **Separate Connection**: Maintains isolated MongoDB connection (`MIGRATIONS_CONNECTION`) for migration metadata
- **Status-based Execution**: Prevents duplicate runs with `pending` → `running` → `applied`/`failed` state machine
- **Upsert Registration**: Updates existing migration metadata without recreating documents

## Migration Definition Patterns

**Decorator Usage:**

```typescript
@Migration({
  order: 10,                    // Execution priority (lower = first)
  description: 'Backfill missing profile slugs',
  retryOnFail: true,           // Retry on app restart after failure
  runOnce: true,               // Default: run only once
  schedule: {                   // Optional scheduling
    cron: '0 3 * * *',         // Cron expression
    timezone: 'Europe/Berlin'  // IANA timezone
  }
})
async backfillSlugs() {
  // Migration logic here
}
```

**Key Conventions:**

- Migration keys default to `<ServiceName>.<methodName>` (override with `key` option)
- Methods must be on NestJS providers (services, controllers, etc.)
- Execution order determined by `order` field (ascending)
- Failed migrations marked as `retryOnFail: true` re-run on app bootstrap

## Module Configuration

**Synchronous Setup:**

```typescript
MigrationsModule.forRoot({
  uri: "mongodb://localhost:27017/my-app",
  dbName: "my-app", // Optional, defaults to 'migrations'
  collectionName: "migrations", // Optional, defaults to 'migrations'
  autoRunOnBootstrap: true, // Optional, defaults to true
});
```

**Asynchronous Setup:**

```typescript
MigrationsModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    uri: config.getOrThrow("MONGO_URI"),
    dbName: config.get("MIGRATIONS_DB", "migrations"),
  }),
});
```

## Development Workflow

**Build Commands:**

- `npm run build`: Compile TypeScript to `dist/` with declarations
- `npm run clean`: Remove generated `dist/` directory
- Publishing: Update `package.json` version, run build, then `npm publish --access public`

**Manual Execution:**

```typescript
// After app.listen() if autoRunOnBootstrap: false
const migrations = app.get(MigrationsService, { strict: false });
await migrations.initAndMaybeRun();
```

## Implementation Guidelines

**When Adding Migrations:**

- Place in service classes that have access to required models/connections
- Use descriptive method names (becomes part of default key)
- Set appropriate `order` values for dependencies
- Include `description` for operational visibility
- Consider `shouldRun` predicate for environment-specific migrations

**Error Handling:**

- Wrap migration logic in try-catch blocks
- Service handles execution locking and status updates
- Failed migrations with `retryOnFail: true` re-attempt on restart

**Scheduling:**

- Cron migrations run via `@nestjs/schedule` integration
- One-off migrations use `setTimeout` with scheduler registry
- Recurring migrations reset to `pending` after successful execution

**Database Schema:**

- Migration metadata stored in configurable collection (default: `migrations`)
- Unique index on `key` field prevents duplicates
- Status tracking enables idempotent execution across app instances

## Common Patterns

**Data Transformation:**

```typescript
@Migration({ order: 5, description: 'Migrate user emails to lowercase' })
async normalizeEmails() {
  await this.userModel.updateMany(
    { email: { $regex: /[A-Z]/ } },
    [{ $set: { email: { $toLower: '$email' } } }]
  );
}
```

**Conditional Execution:**

```typescript
@Migration({
  order: 15,
  shouldRun: (env) => env.NODE_ENV === 'production'
})
async productionOnlyMigration() {
  // Only runs in production
}
```

**Cross-Collection Operations:**

````typescript
@Migration({ order: 20, description: 'Sync user stats to analytics' })
async syncAnalytics() {
  const users = await this.userModel.find({}, 'stats');
  await this.analyticsModel.insertMany(users.map(u => u.stats));
}
```</content>
<parameter name="filePath">/home/samanar/Projects/nestjs-mongo-migrations/.github/copilot-instructions.md
````
