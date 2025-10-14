import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { MigrationStatus } from './migration.constants';

@Schema({ timestamps: true, versionKey: false })
export class MigrationClass {
  /** Unique key: <ServiceName>.<methodName> */
  @Prop({ required: true, unique: true })
  key!: string;

  @Prop({ required: true })
  serviceName!: string;

  @Prop({ required: true })
  methodName!: string;

  @Prop({
    type: String,
    default: 'pending',
    enum: ['pending', 'running', 'applied', 'failed'],
  })
  status!: MigrationStatus;

  @Prop()
  order?: number;

  @Prop()
  description?: string;

  @Prop({ type: Boolean, default: true })
  runOnInit?: true;

  @Prop({ type: Boolean, default: true })
  retryOnError?: true;

  @Prop({ type: Boolean, default: true })
  runOnce?: true;

  @Prop()
  lastRunAt?: Date;

  @Prop()
  error?: string;
}

export type MigrationDocument = HydratedDocument<MigrationClass>;
export const MigrationSchema = SchemaFactory.createForClass(MigrationClass);

// Safety index (unique key already above)
MigrationSchema.index({ key: 1 }, { unique: true });
