/**
 * Main entry point for the NestJS MongoDB Migrations package.
 * Exports all public APIs for consumption by applications.
 */

// Core constants and types
export * from "./migration.constants";

// Migration decorator for marking methods as migrations
export * from "./migration.decorator";

// Main module for configuring the migration system
export * from "./migration.module";

// TypeScript interfaces for configuration options
export * from "./migration.options";

// Migration service (typically not used directly by consumers)
export * from "./migration.service";
