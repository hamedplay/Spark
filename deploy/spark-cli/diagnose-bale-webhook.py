#!/usr/bin/env python3
"""Read-only Bale activation diagnostics; never print credentials or consume updates."""
import argparse
import json
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request


def command(args, stdin=None):
    result = subprocess.run(args, input=stdin, text=True, capture_output=True, timeout=25)
    if result.returncode:
        # Docker/psql stderr may contain private configuration. Do not echo it.
        raise RuntimeError("LOCAL_COMMAND_FAILED: " + args[0])
    return result.stdout


def token(value):
    return re.sub(r"^bot", "", (value or "").strip(), flags=re.I)


def safe_url(value):
    try:
        parsed = urllib.parse.urlsplit(value or "")
        return urllib.parse.urlunsplit((parsed.scheme, parsed.hostname or "", parsed.path, "", ""))
    except ValueError:
        return "INVALID_URL"


def request(url, payload=None):
    req = urllib.request.Request(url, data=payload,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            raw = response.read(65536).decode("utf-8")
            return response.status, json.loads(raw) if raw.startswith("{") else {}
    except urllib.error.HTTPError as error:
        return error.code, {}
    except Exception:
        # Exception URLs can contain the bot token. Report only a stable category.
        return "NETWORK_OR_RESPONSE_ERROR", {}


def inspect_bot(bot_token):
    result = {"token_present": bool(bot_token)}
    if not bot_token:
        return result
    base = "https://tapi.bale.ai/bot" + urllib.parse.quote(bot_token, safe=":")
    status, data = request(base + "/getMe")
    result.update(identity_http=status, identity_ok=data.get("ok") is True,
                  username=(data.get("result") or {}).get("username"))
    status, data = request(base + "/getWebhookInfo")
    info = data.get("result") or {}
    # Upstream free-text errors can contain private data. Emit error category only.
    message = str(info.get("last_error_message", ""))
    result.update(webhook_http=status, webhook_ok=data.get("ok") is True,
                  webhook_url=safe_url(info.get("url")),
                  pending_updates=info.get("pending_update_count"),
                  last_error_date=info.get("last_error_date"),
                  last_error_kind=("HTTP_" + re.search(r"\b(401|403|404|500|502|503|504)\b", message)[1]
                                   if re.search(r"\b(401|403|404|500|502|503|504)\b", message)
                                   else "OTHER" if message else None))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-container", default="supabase-db")
    parser.add_argument("--edge-container", default="supabase-edge-functions")
    args = parser.parse_args()
    for name in (args.db_container, args.edge_container):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", name):
            parser.error("Invalid container name")
    sql = """BEGIN READ ONLY;
SELECT json_build_object(
 'config', (SELECT json_build_object('active',is_active,'username',bot_username,
   'token',bot_token,'webhook_url',webhook_url) FROM public.social_channel_configs WHERE channel='bale'),
 'nonces_30m', (SELECT json_build_object('created',count(*),
   'used',count(*) FILTER (WHERE used_at IS NOT NULL),
   'unused_live',count(*) FILTER (WHERE used_at IS NULL AND expires_at>now()))
   FROM public.bale_link_nonces WHERE created_at>now()-interval '30 minutes'));
ROLLBACK;
"""
    raw = command(["docker", "exec", "-i", args.db_container, "psql", "-X", "-qAt",
                   "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], sql)
    db = json.loads(raw.strip())
    cfg = db.get("config") or {}
    runtime = json.loads(command(["docker", "inspect", "--format", "{{json .Config.Env}}",
                                  args.edge_container])) or []
    env = dict(item.split("=", 1) for item in runtime if "=" in item)
    db_token, edge_token = token(cfg.get("token")), token(env.get("BALE_BOT_TOKEN"))
    report = {"channel_active": cfg.get("active"), "configured_username": cfg.get("username"),
              "configured_webhook": safe_url(cfg.get("webhook_url")),
              "nonces_30m": db.get("nonces_30m"),
              "container_bale_token_present": bool(edge_token),
              "container_supabase_url_present": bool(env.get("SUPABASE_URL")),
              "container_service_key_present": bool(env.get("SUPABASE_SERVICE_ROLE_KEY")),
              "db_and_container_tokens_equal": bool(db_token and db_token == edge_token),
              "database_bot": inspect_bot(db_token)}
    if edge_token and edge_token != db_token:
        report["container_bot"] = inspect_bot(edge_token)
    webhook = safe_url(cfg.get("webhook_url"))
    parsed = urllib.parse.urlsplit(webhook)
    if (parsed.scheme == "https" and parsed.hostname in ("api.shahrmeeting.ir", "shahrmeeting.ir")
            and parsed.path == "/functions/v1/bale-webhook"):
        # Empty update: no nonce, chat, account linking or outbound bot message.
        report["empty_webhook_probe_http"] = request(webhook, b"{}")[0]
    logs = subprocess.run(["docker", "logs", "--since", "30m", args.edge_container],
                          capture_output=True, text=True, timeout=25)
    markers = ("BALE_BOT_TOKEN not configured", "Supabase service environment is incomplete",
               "consume RPC error", "Bale account linked successfully", "unexpected error")
    lines = (logs.stdout + logs.stderr).splitlines()
    report["webhook_log_counts_30m"] = ({marker: sum("[bale-webhook] " + marker in line for line in lines)
                                         for marker in markers} if not logs.returncode else "UNAVAILABLE")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"diagnostic_error": type(error).__name__,
                          "hint": "Check Docker access, container names and postgres SQL access."}))
        raise SystemExit(1)
