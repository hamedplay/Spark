// supabase/functions/messenger-proxy/index.ts
// پراکسی امن برای تلگرام و بله — توکن هرگز به فرانت ارسال نمی‌شود

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Channel = 'telegram' | 'bale';

const BASE_URLS: Record<Channel, string> = {
  telegram: 'https://api.telegram.org',
  bale: 'https://tapi.bale.ai',
};

const ALLOWED_METHODS = new Set([
  'getMe',
  'getWebhookInfo',
  'setWebhook',
  'deleteWebhook',
  'getUpdates',
  'sendMessage',
  'testSupabaseConnection',
]);

const ALLOWED_WEBHOOK_PATHS: Record<Channel, string> = {
  telegram: '/functions/v1/telegram-webhook',
  bale: '/functions/v1/bale-webhook',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function isValidChannel(value: unknown): value is Channel {
  return value === 'telegram' || value === 'bale';
}

function normalizeBotToken(rawToken: string) {
  return rawToken.trim().replace(/^bot/i, '');
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function validateWebhookUrl(channel: Channel, params: any) {
  if (!params || typeof params.url !== 'string') {
    return {
      ok: false as const,
      status: 400,
      description: 'url وبهوک الزامی است',
    };
  }

  let webhookUrl: URL;

  try {
    webhookUrl = new URL(params.url);
  } catch {
    return {
      ok: false as const,
      status: 400,
      description: 'فرمت url وبهوک نامعتبر است',
    };
  }

  const publicApiBaseUrlRaw =
    Deno.env.get('PUBLIC_API_BASE_URL') ?? 'https://api.shahrmeeting.ir';

  let allowedOrigin: string;

  try {
    allowedOrigin = new URL(trimTrailingSlash(publicApiBaseUrlRaw)).origin;
  } catch {
    return {
      ok: false as const,
      status: 500,
      description: 'PUBLIC_API_BASE_URL نامعتبر است',
    };
  }

  const allowedPath = ALLOWED_WEBHOOK_PATHS[channel];

  if (webhookUrl.protocol !== 'https:') {
    return {
      ok: false as const,
      status: 400,
      description: 'آدرس webhook باید https باشد',
    };
  }

  if (webhookUrl.origin !== allowedOrigin) {
    return {
      ok: false as const,
      status: 400,
      description: `دامنه webhook غیرمجاز است. دامنه مجاز: ${allowedOrigin}`,
    };
  }

  const normalizedWebhookPath = trimTrailingSlash(webhookUrl.pathname);
  const normalizedAllowedPath = trimTrailingSlash(allowedPath);

  if (normalizedWebhookPath !== normalizedAllowedPath) {
    return {
      ok: false as const,
      status: 400,
      description: `مسیر webhook غیرمجاز است. مسیر مجاز: ${allowedPath}`,
    };
  }

  return {
    ok: true as const,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== 'POST') {
    return json({
      ok: false,
      description: 'فقط متد POST مجاز است',
    }, 405);
  }

  try {
    let payload: any;

    try {
      payload = await req.json();
    } catch {
      return json({
        ok: false,
        description: 'بدنه درخواست JSON معتبر نیست',
      }, 400);
    }

    const { channel, method, params } = payload ?? {};

    if (!isValidChannel(channel)) {
      return json({
        ok: false,
        description: 'channel نامعتبر است',
      }, 400);
    }

    if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
      return json({
        ok: false,
        description: 'method مجاز نیست',
      }, 400);
    }

    if (params !== undefined) {
      let paramsSize = 0;

      try {
        paramsSize = JSON.stringify(params).length;
      } catch {
        return json({
          ok: false,
          description: 'params قابل تبدیل به JSON نیست',
        }, 400);
      }

      if (paramsSize > 10000) {
        return json({
          ok: false,
          description: 'حجم params زیاد است',
        }, 400);
      }
    }

    const authHeader = req.headers.get('Authorization');

    if (!authHeader) {
      return json({
        ok: false,
        description: 'احراز هویت لازم است',
      }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return json({
        ok: false,
        description: 'متغیرهای محیطی Supabase کامل تنظیم نشده‌اند',
      }, 500);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();

    if (authErr || !user) {
      return json({
        ok: false,
        description: 'دسترسی غیرمجاز',
      }, 401);
    }

    const admin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileErr) {
      return json({
        ok: false,
        description: 'خطا در بررسی نقش: ' + profileErr.message,
      }, 500);
    }

    if (!profile || profile.is_admin !== true) {
      return json({
        ok: false,
        description: 'دسترسی فقط برای ادمین',
      }, 403);
    }

    const { data: cfg, error: cfgErr } = await admin
      .from('social_channel_configs')
      .select('bot_token, ext_supabase_url, ext_supabase_service_key')
      .eq('channel', channel)
      .maybeSingle();

    if (cfgErr) {
      return json({
        ok: false,
        description: 'خطا در خواندن تنظیمات: ' + cfgErr.message,
      }, 500);
    }

    if (!cfg && method !== 'testSupabaseConnection') {
      return json({
        ok: false,
        description: 'تنظیمات این کانال پیدا نشد',
      }, 400);
    }

    if (method === 'setWebhook') {
      const validation = validateWebhookUrl(channel, params);

      if (!validation.ok) {
        return json({
          ok: false,
          description: validation.description,
        }, validation.status);
      }
    }

    if (method === 'testSupabaseConnection') {
      const extUrl = cfg?.ext_supabase_url?.trim();
      const extKey = cfg?.ext_supabase_service_key?.trim();

      if (!extUrl || !extKey) {
        return json({
          ok: false,
          description: 'Supabase URL یا Service Role Key ذخیره نشده است. ابتدا تنظیمات را ذخیره کنید.',
        }, 400);
      }

      let parsedUrl: URL;

      try {
        parsedUrl = new URL(extUrl);
      } catch {
        return json({
          ok: false,
          description: 'فرمت Supabase URL نامعتبر است.',
        }, 400);
      }

      if (parsedUrl.protocol !== 'https:') {
        return json({
          ok: false,
          description: 'Supabase URL باید با https شروع شود.',
        }, 400);
      }

      const healthUrl = new URL('/rest/v1/', parsedUrl.origin).toString();

      console.log('testSupabaseConnection debug:', {
        channel,
        extUrl,
        hasExtKey: Boolean(extKey),
        extKeyLength: extKey?.length ?? 0,
        healthUrl,
      });

      let upstreamResponse: Response;

      try {
        upstreamResponse = await fetch(healthUrl, {
          method: 'GET',
          headers: {
            apikey: extKey,
            Authorization: `Bearer ${extKey}`,
          },
        });
      } catch (error) {
        return json({
          ok: false,
          description: 'اتصال به Supabase برقرار نشد.',
          error: safeErrorMessage(error),
        }, 400);
      }

      const responseText = await upstreamResponse.text();

      if (!upstreamResponse.ok) {
        return json({
          ok: false,
          description: 'Supabase پاسخ موفق برنگرداند.',
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          body: responseText.slice(0, 1000),
        }, 400);
      }

      return json({
        ok: true,
        description: 'اتصال به Supabase با موفقیت برقرار شد.',
        status: upstreamResponse.status,
      });
    }

    const token = cfg?.bot_token ? normalizeBotToken(cfg.bot_token) : '';

    if (!token) {
      return json({
        ok: false,
        description: 'توکن بات تنظیم نشده است. ابتدا توکن را ذخیره کنید.',
      }, 400);
    }

    const baseUrl = BASE_URLS[channel];
    const upstreamUrl = `${baseUrl}/bot${token}/${method}`;

    const hasBody =
      params &&
      typeof params === 'object' &&
      Object.keys(params).length > 0;

    let upstream: Response;

    try {
      upstream = await fetch(upstreamUrl, {
        method: hasBody ? 'POST' : 'GET',
        headers: hasBody
          ? {
              'Content-Type': 'application/json',
            }
          : undefined,
        body: hasBody ? JSON.stringify(params) : undefined,
      });
    } catch (e) {
      console.error('messenger upstream fetch error:', {
        channel,
        method,
        error: safeErrorMessage(e),
      });

      return json({
        ok: false,
        description: 'خطای شبکه در اتصال به API پیام‌رسان',
      }, 502);
    }

    const text = await upstream.text();

    let upstreamData: unknown;

    try {
      upstreamData = text ? JSON.parse(text) : null;
    } catch {
      upstreamData = {
        ok: false,
        description: text.slice(0, 500),
      };
    }

    if (!upstream.ok) {
      return json({
        ok: false,
        description: 'خطا از API پیام‌رسان',
        upstream_status: upstream.status,
        upstream_response: upstreamData,
      }, 502);
    }

    return json(upstreamData, 200);
  } catch (e) {
    console.error('messenger-proxy error:', safeErrorMessage(e));

    return json({
      ok: false,
      description: 'خطای داخلی پراکسی',
    }, 500);
  }
});
