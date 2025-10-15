import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { MigrationStatus } from "./migration.constants";

/**
 * Embedded schema for migration scheduling configuration.
 * Stores scheduling options like cron expressions and timezones.
 */
@Schema({ versionKey: false, _id: false })
export class MigrationSchedule {
  /** One-off execution time (optional) */
  @Prop() at?: Date;
  /** Cron expression for recurring execution (optional) */
  @Prop() cron?: string;
  /** IANA timezone identifier for cron schedules (optional) */
  @Prop() timezone?: string;
}
export const MigrationScheduleSchema =
  SchemaFactory.createForClass(MigrationSchedule);

/**
 * Main migration document schema.
 * Stores metadata and execution state for each discovered migration.
 */
@Schema({ timestamps: true, versionKey: false })
export class MigrationClass {
  /** Unique identifier for the migration (format: 'ServiceName.methodName') */
  @Prop({ required: true, unique: true })
  key!: string;

  /** Name of the service class containing the migration method */
  @Prop({ required: true })
  serviceName!: string;

  /** Name of the migration method */
  @Prop({ required: true })
  methodName!: string;

  /** Current execution status of the migration */
  @Prop({
    type: String,
    default: "pending",
    enum: ["pending", "running", "applied", "failed"],
  })
  status!: MigrationStatus;

  /** Execution priority (lower numbers execute first) */
  @Prop()
  order?: number;

  /** Human-readable description of the migration */
  @Prop()
  description?: string;

  /** Whether this migration should run during app initialization */
  @Prop({ type: Boolean, default: true })
  runOnInit?: true;

  /** Whether to retry failed migrations on app restart */
  @Prop({ type: Boolean, default: true })
  retryOnError?: true;

  /** Whether this migration runs only once (false for recurring migrations) */
  @Prop({ type: Boolean, default: true })
  runOnce?: true;

  /** Timestamp of the last execution */
  @Prop()
  lastRunAt?: Date;

  /** Error message from the last failed execution */
  @Prop()
  error?: string;

  /** Scheduling configuration for automated execution */
  @Prop({ type: MigrationScheduleSchema })
  schedule?: MigrationSchedule;
}

/** TypeScript type for hydrated migration documents */
export type MigrationDocument = HydratedDocument<MigrationClass>;

/** Compiled Mongoose schema for the migration model */
export const MigrationSchema = SchemaFactory.createForClass(MigrationClass);

// Ensure unique constraint on key field for data integrity
MigrationSchema.index({ key: 1 }, { unique: true });
