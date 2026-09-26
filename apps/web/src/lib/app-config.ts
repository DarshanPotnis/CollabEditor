/**
 * The one parsed configuration for the running app. Kept apart from
 * config.ts so the parsing logic stays testable outside a Vite build.
 */
import { loadWebConfig } from './config.js';

export const config = loadWebConfig(import.meta.env);
