import { createClient } from '@supabase/supabase-js';
import { handleSharedAi, SharedAiRateLimit, type SharedAiRequest } from '../../../src/ai/shared/service.ts';
import { buildPlanMessages, buildExplainMessages, buildSpliceMessages, buildWorkoutMessages } from '../../../src/ai/prompts.ts';
import { RoutePlanSchema, ExplanationSchema, spliceAdviceSchema, toStrictJsonSchema, WorkoutWeekSchema } from '../../../src/ai/schema.ts';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-20b';
const MAX_OUTPUT_TOKENS = 1600;
const projectUrl = Deno.env.get('SUPABASE_URL') ?? '';
const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const groqKey = Deno.env.get('GROQ_API_KEY') ?? '';
const enabled = Deno.env.get('SHARED_AI_ENABLED') === 'true'
  && Deno.env.get('GROQ_FREE_TIER_CONFIRMED') === 'true'
  && Boolean(projectUrl && publicKey && serviceKey && groqKey);
const allowedOrigins = (Deno.env.get('APP_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean);

const fetchTimed: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]) });

async function complete(input: SharedAiRequest, signal: AbortSignal): Promise<unknown> {
  const schema = input.operation === 'plan' ? RoutePlanSchema
    : input.operation === 'explain' ? ExplanationSchema
    : input.operation === 'workouts' ? WorkoutWeekSchema
    : spliceAdviceSchema(input.facts.map(fact => fact.id) as [string, ...string[]]);
  const messages = input.operation === 'plan' ? buildPlanMessages(input.summary, input.answers, input.maxDistanciaKm, input.referencias, input.objetivo, input.puertos)
    : input.operation === 'explain' ? buildExplainMessages(input.summary, input.facts)
    : input.operation === 'workouts' ? buildWorkoutMessages(input.summary, input)
    : buildSpliceMessages(input.facts, input.objetivo);
  const schemaName = { plan: 'plan_rutas', explain: 'explicacion_rutas', splice: 'empalme_rutas', workouts: 'entrenos_semana' }[input.operation];
  const response = await fetch(GROQ_ENDPOINT, {
    method: 'POST', headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_completion_tokens: MAX_OUTPUT_TOKENS,
      response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema: toStrictJsonSchema(schema) } } }),
  });
  if (response.status === 429) throw new SharedAiRateLimit(Number(response.headers.get('retry-after')) || 60);
  if (!response.ok) throw new Error('provider');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty');
  let text = ''; let size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64_000) { await reader.cancel(); throw new Error('oversize'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  const payload = JSON.parse(text);
  return JSON.parse(payload.choices?.[0]?.message?.content ?? '');
}

Deno.serve(request => handleSharedAi(request, {
  enabled, allowedOrigins,
  authenticate: async token => {
    const userClient = createClient(projectUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchTimed } });
    const { data, error } = await userClient.auth.getUser(token);
    return error ? null : data.user?.id ?? null;
  },
  consumeQuota: async userId => {
    const admin = createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchTimed } });
    const { data, error } = await admin.rpc('consume_shared_ai_quota', { account_id: userId });
    if (error || !data?.[0]) throw new Error('quota');
    return { allowed: data[0].allowed === true, retryAfterS: Number(data[0].retry_after_s) || 60 };
  },
  complete,
  validateOutput: (input, output) => {
    if (input.operation === 'plan') return RoutePlanSchema.safeParse(output).success;
    if (input.operation === 'workouts') return WorkoutWeekSchema.safeParse(output).success;
    if (input.operation === 'splice') return spliceAdviceSchema(input.facts.map(fact => fact.id) as [string, ...string[]]).safeParse(output).success;
    const parsed = ExplanationSchema.safeParse(output);
    if (!parsed.success || parsed.data.explicaciones.length !== input.facts.length) return false;
    const wanted = new Set(input.facts.map(fact => fact.id));
    const received = new Set(parsed.data.explicaciones.map(item => item.id));
    return received.size === wanted.size && [...received].every(id => wanted.has(id));
  },
}));
