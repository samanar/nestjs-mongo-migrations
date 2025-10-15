import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { DiscoveryService, Reflector } from '@nestjs/core';
import type { Connection, Model } from 'mongoose';
import { MigrationClass, MigrationDocument } from './migration.schema';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import {
  MIGRATIONS_CONNECTION,
  MIGRATIONS_OPTIONS,
  MIGRATION_META,
} from './migration.constants';
import type {
  MigrationsModuleOptions,
  MigrationDecoratorOptions,
} from './migration.options';
import { removeUndefinedValuesInObject } from 'google-auth-library/build/src/util';

@Injectable()
export class MigrationsService {
  private readonly logger = new Logger(MigrationsService.name);
  private readonly collectionName: string;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
    @InjectConnection(MIGRATIONS_CONNECTION) private readonly conn: Connection,
    @InjectModel(MigrationClass.name, MIGRATIONS_CONNECTION)
    private readonly migrationModel: Model<MigrationDocument>,
    private readonly scheduler: SchedulerRegistry,
    @Inject(MIGRATIONS_OPTIONS) private readonly opts: MigrationsModuleOptions,
  ) {
    this.collectionName = opts.collectionName ?? 'migrations';
  }

  async ensureCollectionExists(): Promise<void> {
    const exists = await this.conn.db
      .listCollections({ name: this.collectionName })
      .hasNext();
    if (!exists) {
      await this.conn.db.createCollection(this.collectionName);
      this.logger.log(
        `Created collection "${this.collectionName}" in DB "${this.conn.name}".`,
      );
    }
  }

  async insertOrUpdate(
    key: string,
    serviceName: string,
    methodName: string,
    meta: MigrationDecoratorOptions,
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
        status: 'pending',
      });
    } else {
      await this.migrationModel.updateOne(
        { key },
        {
          ...payload,
        },
      );
    }
  }

  async discoverAndRegister(persistData: boolean = true) {
    const wrappers = this.discovery
      .getProviders()
      .filter(
        (w) => !!w.instance && !!w.metatype && typeof w.instance === 'object',
      );
    const allMethods: Array<{
      key: string;
      serviceName: string;
      methodName: string | symbol;
      meta: MigrationDecoratorOptions;
      instance: any;
    }> = [];
    for (const w of wrappers) {
      const instance = w.instance as Record<string | symbol, any>;
      const serviceName = instance?.constructor?.name ?? 'AnonymousService';
      // iterate own props (including methods on the instance)
      const propNames = [
        ...new Set([
          ...Object.getOwnPropertyNames(Object.getPrototypeOf(instance) ?? {}),
          ...Object.getOwnPropertyNames(instance),
        ]),
      ];
      for (const prop of propNames) {
        const candidate = (instance as any)[prop];
        if (typeof candidate !== 'function') continue;
        const meta = this.reflector.get<MigrationDecoratorOptions | undefined>(
          MIGRATION_META,
          candidate,
        );
        if (!meta) continue;
        const methodName = String(prop);
        const key = meta.key ?? `${serviceName}.${methodName}`;
        if (persistData) {
          await this.insertOrUpdate(key, serviceName, methodName, meta);
        }

        allMethods.push({ key, serviceName, methodName: prop, meta, instance });
      }
    }
    return allMethods;
  }

  /**
   * Run a single migration if not yet applied. Uses "running" lock to avoid duplicates across instances.
   */
  async runOne(key: string, invoke: () => Promise<any>): Promise<void> {
    const isAlreadyRunning = await this.migrationModel.findOne({
      key,
      status: { $ne: 'running' },
    });
    if (!isAlreadyRunning) return;
    isAlreadyRunning.status = 'running';
    isAlreadyRunning.error = '';
    await isAlreadyRunning.save();

    this.logger.log(`Running ${key}...`);
    try {
      await Promise.resolve(invoke());
      await this.migrationModel.updateOne(
        { key },
        {
          $set: { status: 'applied', lastRunAt: new Date(), error: undefined },
        },
      );
      this.logger.log(`Applied ${key}.`);
    } catch (err: any) {
      this.logger.error(`Failed ${key}: ${err?.message ?? err}`);
      await this.migrationModel.updateOne(
        { key },
        { $set: { status: 'failed', error: String(err?.stack ?? err) } },
      );
      throw err;
    }
  }

  private async runRecurring(
    key: string,
    invoke: () => Promise<any>,
  ): Promise<void> {
    const isAlreadyRunning = await this.migrationModel.findOne({
      key,
      status: { $ne: 'running' },
    });
    if (!isAlreadyRunning) return;
    isAlreadyRunning.status = 'running';
    isAlreadyRunning.error = '';
    await isAlreadyRunning.save();
    try {
      this.logger.log(`Running ${key} (cron)...`);
      await Promise.resolve(invoke());
      await this.migrationModel.updateOne(
        { key },
        {
          $set: { status: 'pending', lastRunAt: new Date(), error: undefined },
          $inc: { runCount: 1 },
        },
      );
    } catch (err: any) {
      await this.migrationModel.updateOne(
        { key },
        { $set: { status: 'failed', error: String(err?.stack ?? err) } },
      );
      this.logger.error(`Cron run failed ${key}: ${err?.message ?? err}`);
    }
  }

  private scheduleAt(key: string, when: Date, invoke: () => Promise<any>) {
    const delay = when.getTime() - Date.now();
    if (delay <= 0) {
      void this.runOne(key, invoke); // overdue -> run now
      return;
    }
    const name = `migration:timeout:${key}`;
    const ref = setTimeout(
      async () => {
        try {
          this.scheduler.deleteTimeout(name);
        } catch {}
        await this.runOne(key, invoke);
      },
      Math.min(delay, 2 ** 31 - 1),
    ); // setTimeout cap
    this.scheduler.addTimeout(name, ref);
    this.logger.log(`Scheduled ${key} at ${when.toISOString()}`);
  }

  private scheduleCron(
    key: string,
    expr: string,
    timezone: string | undefined,
    invoke: () => Promise<any>,
  ) {
    const name = `migration:cron:${key}`;
    const job = new CronJob(
      expr,
      () => this.runRecurring(key, invoke),
      null,
      false,
      timezone,
    );
    job.start();
    this.scheduler.addCronJob(name, job);
    this.logger.log(
      `Cron scheduled ${key} (${expr}${timezone ? ` ${timezone}` : ''})`,
    );
  }

  /**
   * Ensure collection, discover, register, and (optionally) run pending migrations.
   */
  async initAndMaybeRun(): Promise<void> {
    await this.ensureCollectionExists();
    const allMethods = await this.discoverAndRegister();
    for await (const mig of this.migrationModel
      .find({
        runOnInit: true,
        $or: [
          { status: 'pending' },
          { status: 'failed', retryOnError: true },
          { runOnce: false },
        ],
      })
      .sort({ order: 1 })
      .cursor()) {
      const foundMethod = allMethods.find((i) => i.key == mig.key);
      if (!foundMethod) continue;
      const invoke = async () =>
        (foundMethod.instance as any)[mig.methodName].call(
          foundMethod.instance,
        );

      if (mig.schedule?.cron) {
        this.scheduleCron(
          mig.key,
          mig.schedule.cron,
          mig.schedule.timezone,
          invoke,
        );
        await this.runRecurring(mig.key, invoke);
        continue;
      }

      // If one-off "at" is provided: schedule a single execution
      if (mig.schedule?.at) {
        const at = new Date(mig.schedule.at);
        this.scheduleAt(mig.key, at, invoke);
        continue;
      }

      await this.runOne(mig.key, invoke);
    }
  }
}
