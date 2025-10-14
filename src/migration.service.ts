import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { DiscoveryService, Reflector } from '@nestjs/core';
import type { Connection, Model } from 'mongoose';
import { MigrationClass, MigrationDocument } from './migration.schema';
import {
  MIGRATIONS_CONNECTION,
  MIGRATIONS_OPTIONS,
  MIGRATION_META,
} from './migration.constants';
import type {
  MigrationsModuleOptions,
  MigrationDecoratorOptions,
} from './migration.options';

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
    await this.migrationModel.updateOne(
      { key },
      { $set: { status: 'running', error: undefined } },
      { new: true },
    );

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
      await this.runOne(mig.key, async () => {
        const fn = (foundMethod.instance as any)[mig.methodName];
        return fn.call(foundMethod.instance);
      });
    }
  }
}
