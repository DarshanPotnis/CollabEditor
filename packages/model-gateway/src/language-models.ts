/**
 * A provider's model for one call. Always an instance, never a model id string:
 * the `ai` package resolves a bare string through Vercel's AI Gateway. Built per
 * call with that call's key and never cached, so a caller's own key lives only
 * as long as their request.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { ModelTarget } from './model-gateway.js';

export type ModelInstance = Exclude<LanguageModel, string>;

export function createLanguageModel({ provider, model, apiKey }: ModelTarget): ModelInstance {
  switch (provider) {
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey })(model);
    case 'anthropic':
      return createAnthropic({ apiKey })(model);
    case 'openai':
      return createOpenAI({ apiKey })(model);
  }
}
