import { createClient } from 'npm:@supabase/supabase-js@2';

function jsonResponse(body: unknown, status = 200, correlationId?: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (correlationId) headers['x-correlation-id'] = correlationId;
  return new Response(JSON.stringify(body), { status, headers });
}

function getSecretKey(): string {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (raw) {
    const keys = JSON.parse(raw) as Record<string, string>;
    if (keys.default) return keys.default;
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  throw new Error('MES Supabase secret key не настроен');
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return jsonResponse({ message: 'Метод не поддерживается' }, 405);

  const correlationId = request.headers.get('x-correlation-id')?.trim() || crypto.randomUUID();
  const expectedSecret = Deno.env.get('WORKFORCE_INGEST_SECRET')?.trim();
  const suppliedSecret = request.headers.get('x-workforce-integration-secret')?.trim();

  if (!expectedSecret) return jsonResponse({ message: 'MES Workforce integration secret не настроен' }, 503, correlationId);
  if (!suppliedSecret || suppliedSecret !== expectedSecret) return jsonResponse({ message: 'Требуется service-to-service авторизация' }, 401, correlationId);

  try {
    const body = await request.json() as { plan?: Record<string, unknown> };
    if (!body.plan || typeof body.plan !== 'object') throw new Error('Требуется body.plan с опубликованным MES-планом');

    const importedBy = request.headers.get('x-actor-id')?.trim();
    if (!importedBy) throw new Error('Отсутствует x-actor-id');

    const url = Deno.env.get('SUPABASE_URL');
    if (!url) throw new Error('SUPABASE_URL не настроен');

    const client = createClient(url, getSecretKey());
    const { data, error } = await client.rpc('mes_import_workforce_plan', {
      p_payload: body.plan,
      p_imported_by: importedBy
    });

    if (error) {
      throw new Error([error.message, error.details, error.hint].filter(Boolean).join(' | '));
    }
    if (!data) throw new Error('mes_import_workforce_plan вернул пустой ответ');

    return jsonResponse(data, 202, correlationId);
  } catch (error) {
    return jsonResponse({ message: error instanceof Error ? error.message : 'Импорт Workforce отклонён' }, 400, correlationId);
  }
});
