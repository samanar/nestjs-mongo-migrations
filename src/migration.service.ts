import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/mongoose";
import { DiscoveryService, Reflector } from "@nestjs/core";
import type { Connection, Model } from "mongoose";
import { MigrationClass, MigrationDocument } from "./migration.schema";
import {
  MIGRATIONS_CONNECTION,
  MIGRATIONS_OPTIONS,
  MIGRATION_META,
} from "./migration.constants";
import type {
  MigrationsModuleOptions,
  MigrationDecoratorOptions,
} from "./migration.options";

/**
 * Dynamic imports for optional @nestjs/schedule package.
 * These are loaded at runtime to avoid import errors when the package is not installed.
 * If not available, scheduling features will be gracefully disabled.
 */
let SchedulerRegistry: any;
let CronJob: any;

try {
  const scheduleModule = require("@nestjs/schedule");
  SchedulerRegistry = scheduleModule.SchedulerRegistry;
} catch {
  // @nestjs/schedule not installed - scheduling features will be disabled
}

try {
  const cronModule = require("cron");
  CronJob = cronModule.CronJob;
} catch {
  // cron package not installed - cron scheduling will be disabled
}

/**
 * Core service responsible for discovering, registering, and executing database migrations.
 * Uses reflection to find methods decorated with @Migration() and manages their execution
 * with proper ordering, retry logic, and optional scheduling.
 */
@Injectable()
export class MigrationsService {
  private readonly logger = new Logger(MigrationsService.name);
  private readonly collectionName: string;
  private readonly scheduler?: any;
  private readonly schedulingAvailable: boolean;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
    @InjectConnection(MIGRATIONS_CONNECTION) private readonly conn: Connection,
    @InjectModel(MigrationClass.name, MIGRATIONS_CONNECTION)
    private readonly migrationModel: Model<MigrationDocument>,
    @Optional() @Inject("SchedulerRegistry") scheduler: any,
    @Inject(MIGRATIONS_OPTIONS) private readonly opts: MigrationsModuleOptions
  ) {
    this.collectionName = opts.collectionName ?? "migrations";
    this.scheduler = scheduler;
    this.schedulingAvailable = !!(SchedulerRegistry && CronJob && scheduler);

    if (!this.schedulingAvailable) {
      this.logger.warn(
        "@nestjs/schedule not detected - scheduled migrations will be skipped"
      );
    }
  }

  /**
   * Ensures the migrations collection exists in the database.
   * Creates the collection if it doesn't exist to store migration metadata.
   */
  async ensureCollectionExists(): Promise<void> {
    const exists = await this.conn?.db
      ?.listCollections({ name: this.collectionName })
      .hasNext();
    if (!exists) {
      await this.conn.db?.createCollection(this.collectionName);
      this.logger.log(
        `Created collection "${this.collectionName}" in DB "${this.conn.name}".`
      );
    }
  }

  /**
   * Registers or updates a migration in the database.
   * Uses upsert operation to either create new migration metadata or update existing one.
   * This allows migrations to be modified without recreating the document.
   *
   * @param key - Unique identifier for the migration (ServiceName.methodName)
   * @param serviceName - Name of the service class containing the migration
   * @param methodName - Name of the migration method
   * @param meta - Migration decorator options and configuration
   */
  async insertOrUpdate(
    key: string,
    serviceName: string,
    methodName: string,
    meta: MigrationDecoratorOptions
  ): Promise<void> {
    // Upsert registration
    const alreadyFound = await this.migrationModel.findOne({ key });
    const payload = {
      key,
      serviceName,
      methodName,
      order: meta?.order ?? 0,
      description: meta?.description,
      runOnInit: meta?.runOnInit ?? true,
      runOnce: meta?.runOnce ?? true,
      retryOnFail: meta?.retryOnFail ?? true,
      schedule: {
        at: meta.schedule?.at,
        cron: meta.schedule?.cron,
        timezone: meta.schedule?.timezone,
      },
    };
    if (!alreadyFound) {
      await this.migrationModel.create({
        ...payload,
        status: "pending",
      });
    } else {
      await this.migrationModel.updateOne(
        { key },
        {
          ...payload,
        }
      );
    }
  }

  /**
   * Discovers all methods decorated with @Migration() across all NestJS providers.
   * Uses reflection to scan service instances and extract migration metadata.
   * Optionally persists the discovered migrations to the database.
   *
   * @param persistData - Whether to save discovered migrations to the database
   * @returns Array of discovered migration methods with their metadata
   */
  async discoverAndRegister(persistData: boolean = true) {
    // Get all NestJS providers (services, controllers, etc.) that have instances
    const wrappers = this.discovery
      .getProviders()
      .filter(
        (w) => !!w.instance && !!w.metatype && typeof w.instance === "object"
      );

    // Array to collect all discovered migration methods
    const allMethods: Array<{
      key: string;
      serviceName: string;
      methodName: string | symbol;
      meta: MigrationDecoratorOptions;
      instance: any;
    }> = [];

    // Iterate through each provider instance
    for (const w of wrappers) {
      const instance = w.instance as Record<string | symbol, any>;
      const serviceName = instance?.constructor?.name ?? "AnonymousService";

      // Get all property names from the instance and its prototype
      const propNames = [
        ...new Set([
          ...Object.getOwnPropertyNames(Object.getPrototypeOf(instance) ?? {}),
          ...Object.getOwnPropertyNames(instance),
        ]),
      ];

      // Check each property for the @Migration decorator
      for (const prop of propNames) {
        const candidate = (instance as any)[prop];
        if (typeof candidate !== "function") continue;

        // Use reflection to get the migration metadata from the decorator
        const meta = this.reflector.get<MigrationDecoratorOptions | undefined>(
          MIGRATION_META,
          candidate
        );
        if (!meta) continue;

        const methodName = String(prop);
        const key = meta.key ?? `${serviceName}.${methodName}`;

        // Persist to database if requested
        if (persistData) {
          await this.insertOrUpdate(key, serviceName, methodName, meta);
        }

        allMethods.push({ key, serviceName, methodName: prop, meta, instance });
      }
    }
    return allMethods;
  }

  /**
   * Executes a single migration with proper locking and error handling.
   * Uses a "running" status lock to prevent duplicate execution across multiple app instances.
   * Updates migration status to "applied" on success or "failed" on error.
   *
   * @param key - Unique migration identifier
   * @param invoke - Function that executes the migration logic
   */
  async runOne(key: string, invoke: () => Promise<any>): Promise<void> {
    // Check if migration is already running (prevents duplicate execution)
    const isAlreadyRunning = await this.migrationModel.findOne({
      key,
      status: { $ne: "running" },
    });
    if (!isAlreadyRunning) return;

    // Mark as running to lock it
    isAlreadyRunning.status = "running";
    isAlreadyRunning.error = "";
    await isAlreadyRunning.save();

    this.logger.log(`Running ${key}...`);
    try {
      // Execute the migration
      await Promise.resolve(invoke());

      // Mark as successfully applied
      await this.migrationModel.updateOne(
        { key },
        {
          $set: { status: "applied", lastRunAt: new Date(), error: undefined },
        }
      );
      this.logger.log(`Applied ${key}.`);
    } catch (err: any) {
      this.logger.error(`Failed ${key}: ${err?.message ?? err}`);

      // Mark as failed with error details
      await this.migrationModel.updateOne(
        { key },
        { $set: { status: "failed", error: String(err?.stack ?? err) } }
      );
      throw err;
    }
  }

  /**
   * Executes a recurring migration (cron-based) with proper locking.
   * Unlike runOne, this resets the status to "pending" after successful execution
   * so it can run again on the next cron schedule.
   *
   * @param key - Unique migration identifier
   * @param invoke - Function that executes the migration logic
   */
  private async runRecurring(
    key: string,
    invoke: () => Promise<any>
  ): Promise<void> {
    // Check if migration is already running
    const isAlreadyRunning = await this.migrationModel.findOne({
      key,
      status: { $ne: "running" },
    });
    if (!isAlreadyRunning) return;

    // Mark as running
    isAlreadyRunning.status = "running";
    isAlreadyRunning.error = "";
    await isAlreadyRunning.save();

    try {
      this.logger.log(`Running ${key} (cron)...`);
      await Promise.resolve(invoke());

      // Reset to pending for next cron run and increment run count
      await this.migrationModel.updateOne(
        { key },
        {
          $set: { status: "pending", lastRunAt: new Date(), error: undefined },
          $inc: { runCount: 1 },
        }
      );
    } catch (err: any) {
      // Mark as failed but don't throw - cron jobs should continue
      await this.migrationModel.updateOne(
        { key },
        { $set: { status: "failed", error: String(err?.stack ?? err) } }
      );
      this.logger.error(`Cron run failed ${key}: ${err?.message ?? err}`);
    }
  }

  /**
   * Schedules a one-off migration to run at a specific date/time.
   * Falls back to immediate execution if @nestjs/schedule is not available.
   *
   * @param key - Unique migration identifier
   * @param when - Date/time when the migration should run
   * @param invoke - Function that executes the migration logic
   */
  private scheduleAt(key: string, when: Date, invoke: () => Promise<any>) {
    if (!this.schedulingAvailable) {
      this.logger.warn(
        `Cannot schedule ${key} - @nestjs/schedule not available. Running immediately.`
      );
      void this.runOne(key, invoke);
      return;
    }

    const delay = when.getTime() - Date.now();
    if (delay <= 0) {
      // If the scheduled time is in the past, run immediately
      void this.runOne(key, invoke);
      return;
    }

    // Create a named timeout that can be managed by the scheduler registry
    const name = `migration:timeout:${key}`;
    const ref = setTimeout(async () => {
      try {
        this.scheduler.deleteTimeout(name);
      } catch {}
      await this.runOne(key, invoke);
    }, Math.min(delay, 2 ** 31 - 1)); // setTimeout cap

    // Register the timeout with NestJS scheduler for proper cleanup
    this.scheduler.addTimeout(name, ref);
    this.logger.log(`Scheduled ${key} at ${when.toISOString()}`);
  }

  /**
   * Schedules a recurring migration using cron expression.
   * Creates a cron job that will execute the migration repeatedly.
   * Skips silently if @nestjs/schedule is not available.
   *
   * @param key - Unique migration identifier
   * @param expr - Cron expression (e.g., "0 3 * * *" for daily at 3am)
   * @param timezone - IANA timezone for the cron schedule
   * @param invoke - Function that executes the migration logic
   */
  private scheduleCron(
    key: string,
    expr: string,
    timezone: string | undefined,
    invoke: () => Promise<any>
  ) {
    if (!this.schedulingAvailable) {
      this.logger.warn(
        `Cannot schedule cron ${key} - @nestjs/schedule not available. Skipping.`
      );
      return;
    }

    // Create a named cron job for management
    const name = `migration:cron:${key}`;
    const job = new CronJob(
      expr,
      () => this.runRecurring(key, invoke), // Execute recurring migration
      null, // No callback on completion
      false, // Don't start immediately
      timezone // Timezone for the cron schedule
    );

    // Start the cron job and register it with NestJS scheduler
    job.start();
    this.scheduler.addCronJob(name, job);
    this.logger.log(
      `Cron scheduled ${key} (${expr}${timezone ? ` ${timezone}` : ""})`
    );
  }

  /**
   * Main initialization method that orchestrates the entire migration process.
   * Ensures collection exists, discovers migrations, registers them, and executes
   * pending migrations in the correct order. Also sets up scheduled migrations.
   */
  async initAndMaybeRun(): Promise<void> {
    // Ensure the migrations collection exists
    await this.ensureCollectionExists();

    // Discover all @Migration decorated methods and register them in DB
    const allMethods = await this.discoverAndRegister();

    // Process migrations that should run on initialization
    for await (const mig of this.migrationModel
      .find({
        runOnInit: true,
        $or: [
          { status: "pending" }, // New migrations
          { status: "failed", retryOnError: true }, // Failed migrations that should retry
          { runOnce: false }, // Recurring migrations
        ],
      })
      .sort({ order: 1 }) // Execute in order (lower numbers first)
      .cursor()) {
      // Find the corresponding method instance
      const foundMethod = allMethods.find((i) => i.key == mig.key);
      if (!foundMethod) continue;

      // Create a bound function to execute the migration
      const invoke = async () =>
        (foundMethod.instance as any)[mig.methodName].call(
          foundMethod.instance
        );

      // Handle cron-scheduled migrations
      if (mig.schedule?.cron) {
        this.scheduleCron(
          mig.key,
          mig.schedule.cron,
          mig.schedule.timezone,
          invoke
        );
        // Also run immediately on startup
        await this.runRecurring(mig.key, invoke);
        continue;
      }

      // Handle one-off scheduled migrations
      if (mig.schedule?.at) {
        const at = new Date(mig.schedule.at);
        this.scheduleAt(mig.key, at, invoke);
        continue;
      }

      // Handle regular migrations
      await this.runOne(mig.key, invoke);
    }
  }
}
