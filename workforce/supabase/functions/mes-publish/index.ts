import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function authenticateUser(request: Request) {
  const authorization = request.headers.get('authorization')?.trim();
  if (!authorization?.startsWith('Bearer ')) throw new Error('Требуется пользовательская сессия Workforce');

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) throw new Error('Пустой пользовательский токен Workforce');

  const url = Deno.env.get('SUPABASE_URL');
  const publishableKeysRaw = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (!url || !publishableKeysRaw) throw new Error('Supabase runtime для Workforce не настроен');

  const publishableKeys = JSON.parse(publishableKeysRaw) as Record<string, string>;
  const publishableKey = publishableKeys.default;
  if (!publishableKey) throw new Error('Не найден default publishable key Workforce');

  const client = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error('Пользователь Workforce не авторизован');
  return data.user;
}

function getMesIngestSecret(): string {
  return Deno.env.get('WORKFORCE_INGEST_SECRET')?.trim()
    || Deno.env.get('MES_INGEST_SECRET')?.trim()
    || '';
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ message: 'Метод не поддерживается' }, 405);

  try {
    const user = await authenticateUser(request);
    const mesUrl = Deno.env.get('MES_SUPABASE_URL')?.trim();
    const integrationSecret = getMesIngestSecret();
    if (!mesUrl || !integrationSecret) throw new Error('MES transport secrets Workforce не настроены');

    const body = await request.json() as { plan?: Record<string, unknown> };
    if (!body.plan || typeof body.plan !== 'object') throw new Error('Требуется body.plan с опубликованным MES-планом');

    const correlationId = request.headers.get('x-correlation-id')?.trim()
      || crypto.randomUUID();
    const actorId = `workforce:user:${user.id}`;

    const upstream = await fetch(`${mesUrl.replace(/\/$/, '')}/functions/v1/workforce-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-workforce-integration-secret': integrationSecret,
        'x-actor-id': actorId,
        'x-correlation-id': correlationId
      },
      body: JSON.stringify({ plan: { ...body.plan, publishedBy: actorId } })
    });

    const responseText = await upstream.text();
    let payload: unknown = { message: responseText || 'MES вернул пустой ответ' };
    if (responseText) {
      try { payload = JSON.parse(responseText); } catch { /* оставляем текстовую ошибку */ }
    }

    return jsonResponse(payload, upstream.status);
  } catch (error) {
    return jsonResponse({ message: error instanceof Error ? error.message : 'Публикация MES отклонена' }, 400);
  }
});
