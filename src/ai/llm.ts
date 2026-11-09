import type { z } from 'zod';
import type { Settings } from '../domain/types';
import { isAbort } from './abort';
import type { ChatMessage } from './prompts';

/**
 * Cliente de chat compatible con OpenAI (`POST {baseUrl}/chat/completions`), Groq por defecto.
 * Pide salida JSON con esquema estricto y la valida con zod. No reintenta: eso lo decide quien llama.
 */

export type LlmErrorKind =
  | 'no_model'
  | 'unauthorized'
  | 'rate_limit'
  | 'invalid_json'
  | 'model_unsupported'
  | 'bad_request'
  | 'network'
  /** El servicio común de IA responde 503: sin configurar, sin cuota comprobable o caído. */
  | 'unavailable'
  | 'other';

/** `message` es el texto que ve el usuario; `raw`, el contenido recibido, que se usa al reintentar. */
export class LlmError extends Error {
  constructor(
    public kind: LlmErrorKind,
    message: string,
    public retryAfterS?: number,
    public raw?: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Límites publicados por Groq (plan Developer, 2026-11-06). Solo se citan para los modelos que los tienen. */
const KNOWN_LIMITS: Record<string, string> = {
  'openai/gpt-oss-20b': '30 peticiones por minuto y 1.000 al día',
  'openai/gpt-oss-120b': '30 peticiones por minuto y 1.000 al día',
};

const SCHEMA_MISMATCH = 'Generated JSON does not match the expected schema';

const MSG = {
  no_model: 'Elige un modelo en Ajustes (por ejemplo, openai/gpt-oss-20b).',
  unauthorized: 'El proveedor de IA rechaza la clave. Revísala en Ajustes.',
  network: 'No se puede conectar con el proveedor de IA. Revisa la conexión y la URL base en Ajustes.',
  model_unsupported: 'Este modelo no admite salida JSON con esquema. Usa openai/gpt-oss-20b u otro que la admita.',
};

export async function chatJson<T>(
  cfg: Settings['llm'],
  req: { messages: ChatMessage[]; schemaName: string; jsonSchema: Record<string, unknown>; schema: z.ZodType<T>; signal?: AbortSignal },
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const model = cfg.model.trim();
  if (!model) throw new LlmError('no_model', MSG.no_model);

  let res: Response;
  try {
    res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: req.messages,
        response_format: {
          type: 'json_schema',
          json_schema: { name: req.schemaName, strict: true, schema: req.jsonSchema },
        },
        temperature: 0.3,
      }),
      signal: req.signal,
    });
  } catch (e) {
    if (req.signal?.aborted || isAbort(e)) throw e;
    // El navegador da el mismo TypeError para un fallo de red y para un bloqueo CORS.
    throw new LlmError('network', MSG.network);
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toLlmError(res, body, model);

  const content = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  const raw = typeof content === 'string' ? content : '';

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new LlmError('invalid_json', 'La respuesta de la IA no es JSON.', undefined, raw);
  }

  const parsed = req.schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length ? issue.path.join('.') : '(raíz)';
    throw new LlmError('invalid_json', `La IA ha devuelto un JSON que no cumple el formato: ${where}: ${issue.message}`, undefined, raw);
  }
  return parsed.data;
}

/** El cuerpo de error de un proveedor compatible con OpenAI es `{ error: { message, type, code } }`. */
function toLlmError(res: Response, body: unknown, model: string): LlmError {
  const { status } = res;
  const error = (body as { error?: { message?: unknown } } | null)?.error;
  const detail = typeof error?.message === 'string' ? error.message : '';

  if (status === 401 || status === 403) return new LlmError('unauthorized', MSG.unauthorized);
  if (status === 429) return rateLimitError(res, model);
  if (status === 400 && detail.includes(SCHEMA_MISMATCH)) {
    return new LlmError('invalid_json', `La IA ha devuelto un JSON que no cumple el formato: ${detail}`);
  }
  if (status === 400 && /response_format|json_schema/.test(detail)) {
    return new LlmError('model_unsupported', MSG.model_unsupported);
  }
  if (status >= 500) {
    return new LlmError('other', `El proveedor de IA ha fallado (HTTP ${status}). Vuelve a probar en unos minutos.`);
  }
  const text = `El proveedor de IA rechaza la petición (HTTP ${status})`;
  return new LlmError('bad_request', detail ? `${text}: ${detail}` : `${text}.`);
}

function rateLimitError(res: Response, model: string): LlmError {
  const seconds = Number.parseFloat(res.headers.get('retry-after') ?? '');
  const retryAfterS = Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
  const limits = KNOWN_LIMITS[model] ? ` (con ${model}, ${KNOWN_LIMITS[model]})` : '';
  const wait = retryAfterS !== undefined ? `${retryAfterS} s` : 'un minuto';
  return new LlmError('rate_limit', `El proveedor de IA ha llegado a su límite${limits}. Prueba dentro de ${wait}.`, retryAfterS);
}
