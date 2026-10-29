# Application-layer update helpers for Spark Manager.
#
# Internet App updates deploy frontend and Edge Functions from one source commit.
# They must not apply SQL migrations, touch PostgreSQL, rebuild Supabase/worker
# images, reconcile schedulers, or update Manager.

application_prepare_frontend_env() {
  local root="$1" anon
  anon="$(env_get "${SUPABASE_ROOT}/.env" ANON_KEY)"
  [[ -n "$anon" ]] || { fail "ANON_KEY not available; frontend build stopped."; return 1; }
  [[ -n "${APP_DOMAIN:-}" ]] || { fail "APP_DOMAIN not set; frontend build stopped."; return 1; }

  env_set "${root}/.env.production" VITE_SUPABASE_URL "https://${APP_DOMAIN}"
  env_set "${root}/.env.production" VITE_SUPABASE_ANON_KEY "$anon"
  chmod 600 "${root}/.env.production"
}

application_validate_frontend_build() {
  local root="$1"
  [[ -f "${root}/dist/index.html" ]] || {
    fail "Frontend build is missing dist/index.html."
    return 1
  }

  if [[ -n "${API_DOMAIN:-}" ]] && grep -R -F -q -- "https://${API_DOMAIN}" "${root}/dist"; then
    fail "Frontend build still contains legacy API hostname: https://${API_DOMAIN}"
    return 1
  fi
  if grep -R -F -q -- '%VITE_SUPABASE_URL%' "${root}/dist"; then
    fail "Frontend build still contains unresolved VITE_SUPABASE_URL placeholder."
    return 1
  fi
}

application_frontend_health() {
  [[ -n "${APP_DOMAIN:-}" ]] || return 1
  curl --noproxy '*' -fIsS --connect-timeout 5 --max-time 10 \
    --resolve "${APP_DOMAIN}:443:127.0.0.1" \
    "https://${APP_DOMAIN}/" >/dev/null
}

application_functions_container() {
  local inventory
  local -a candidates
  inventory="$(docker ps --format '{{.ID}} {{.Image}} {{.Names}}')" || return 1
  mapfile -t candidates < <(awk '$2 ~ /supabase\/edge-runtime/ || $3 == "spark-edge-runtime" || $3 == "supabase-edge-functions" {print $1}' <<<"$inventory")
  if [[ ${#candidates[@]} -ne 1 ]]; then
    printf 'Expected exactly one running Spark Functions runtime; found %s.\n' "${#candidates[@]}" >&2
    return 1
  fi
  printf '%s\n' "${candidates[0]}"
}

application_functions_mount() {
  docker inspect "$1" | python3 -c '
import json,sys
from pathlib import Path
row=json.load(sys.stdin)[0]
if "VERIFY_JWT=true" in row.get("Config",{}).get("Env",[]):
    raise SystemExit("Spark router requires in-function authentication; VERIFY_JWT=true is unsupported")
mounts=row.get("Mounts",[])
matches=[m for m in mounts if m["Destination"]=="/home/deno/functions" and m["Type"]=="bind"]
if len(matches)!=1:
    raise SystemExit("Expected one Functions bind mount at /home/deno/functions")
if any(m["Destination"].startswith("/home/deno/functions/") for m in mounts):
    raise SystemExit("Nested Functions mounts prevent a consistent source update")
root=Path(matches[0]["Source"]).resolve()
repo=Path(sys.argv[1]).resolve()
source=repo/"supabase/functions"
if root==source or root in source.parents or source in root.parents:
    raise SystemExit("Functions runtime must be separate from the source checkout")
if not (root/"main/index.ts").is_file():
    raise SystemExit("Existing Functions main router is missing")
print(root)
' "$SPARK_ROOT"
}

application_stage_functions() {
  local source_root="$1" destination="$2" runtime_root="$3"
  [[ -d "${source_root}/supabase/functions" && -f "${source_root}/deploy/spark-cli/edge-main/index.ts" ]] || return 1
  # The destination is a new, empty tree on every update: copy all source files.
  rsync -a --delete "${source_root}/supabase/functions/" "${destination}/" || return 1
  if [[ -f "${runtime_root}/deno.jsonc" ]]; then
    install -m 0644 "${runtime_root}/deno.jsonc" "${destination}/deno.jsonc" || return 1
  fi
  mkdir -p "${destination}/main" || return 1
  install -m 0644 "${source_root}/deploy/spark-cli/edge-main/index.ts" "${destination}/main/index.ts"
}

application_functions_health() {
  local container="$1" response
  [[ "$(docker inspect --format '{{.State.Running}}' "$container")" == true ]] || return 1
  # OPTIONS boots the SMS handler but cannot authenticate or drain a send queue.
  response="$(curl --noproxy '*' -fsS --request OPTIONS --connect-timeout 5 --max-time 10 \
    --retry 4 --retry-connrefused --retry-delay 1 --retry-max-time 30 --dump-header - \
    --resolve "${APP_DOMAIN}:443:127.0.0.1" \
    "https://${APP_DOMAIN}/functions/v1/send-sms" --output /dev/null)" || return 1
  grep -Eiq '^access-control-allow-headers:.*x-meeting-worker-token' <<<"$response"
}

update_spark() (
  title
  new_log "update-internet-app"

  [[ -d "${SPARK_ROOT}/.git" ]] || { fail "Spark source repository not found: ${SPARK_ROOT}"; return 1; }
  [[ -f "${SPARK_ROOT}/package.json" ]] || { fail "Application package.json not found in ${SPARK_ROOT}."; return 1; }
  [[ -f "${SUPABASE_ROOT}/.env" ]] || { fail "Supabase environment is required only to read the existing frontend ANON_KEY."; return 1; }

  if [[ -n "$(git -C "$SPARK_ROOT" status --porcelain)" ]]; then
    fail "Spark source has uncommitted changes; Internet App update stopped."
    git -C "$SPARK_ROOT" status --short | tee -a "$CURRENT_LOG"
    return 1
  fi

  local old_sha target_sha stage frontend_next frontend_prev
  local modules_next modules_prev functions_container functions_live
  local functions_next="" functions_prev=""
  local source_advanced=0 frontend_switched=0 modules_switched=0 functions_switched=0 update_success=0

  functions_container="$(application_functions_container)" || { fail "Unable to identify the Functions runtime; nothing deployed."; return 1; }
  functions_live="$(application_functions_mount "$functions_container")" || { fail "Unable to identify a safe Functions mount; nothing deployed."; return 1; }
  info "Functions container: ${functions_container}"
  info "Functions source mount: ${functions_live}"

  old_sha="$(git -C "$SPARK_ROOT" rev-parse HEAD)" || return 1
  run_logged "Fetch latest application source from origin/main" \
    git -C "$SPARK_ROOT" fetch origin main || return 1
  target_sha="$(git -C "$SPARK_ROOT" rev-parse origin/main)" || return 1

  info "Current application source: ${old_sha}"
  info "Target application source : ${target_sha}"

  local backup_ref="refs/spark-manager/backups/app-update-$(date -u +%Y%m%dT%H%M%SZ)-$$-${old_sha:0:12}"
  run_logged "Preserve current application source for rollback" \
    git -C "$SPARK_ROOT" update-ref "$backup_ref" "$old_sha" || return 1

  stage="/opt/spark-app-update-${target_sha:0:12}-$$"
  frontend_next="/var/www/spark.next.$$"
  frontend_prev="/var/www/spark.prev.$$"
  modules_next="${SPARK_ROOT}/node_modules.next.$$"
  modules_prev="${SPARK_ROOT}/node_modules.prev.$$"

  rollback_application() {
    if (( frontend_switched == 0 && modules_switched == 0 && functions_switched == 0 && source_advanced == 0 )); then return 0; fi
    warn "Rolling back application frontend and Functions."
    if (( frontend_switched == 1 )); then
      if rm -rf /var/www/spark && { [[ ! -d "$frontend_prev" ]] || mv "$frontend_prev" /var/www/spark; }; then
        frontend_switched=0
        chown -R www-data:www-data /var/www/spark || true
      else
        fail "Frontend rollback failed; previous files retained at ${frontend_prev}."
      fi
    fi
    if (( modules_switched == 1 )); then
      if rm -rf "${SPARK_ROOT}/node_modules" && { [[ ! -d "$modules_prev" ]] || mv "$modules_prev" "${SPARK_ROOT}/node_modules"; }; then
        modules_switched=0
      else
        fail "Dependency rollback failed; previous files retained at ${modules_prev}."
      fi
    fi
    if (( functions_switched == 1 )); then
      if [[ -d "$functions_prev" ]] && rm -rf "$functions_live" && mv "$functions_prev" "$functions_live"; then
        functions_switched=0
        docker restart "$functions_container" >>"$CURRENT_LOG" 2>&1 ||
          warn "Previous Functions files restored, but runtime restart failed; inspect ${functions_container}."
      else
        fail "Functions rollback failed; previous files retained at ${functions_prev}."
      fi
    fi
    if (( source_advanced == 1 )); then
      if git -C "$SPARK_ROOT" reset --hard "$old_sha" >>"$CURRENT_LOG" 2>&1; then
        source_advanced=0
      else
        fail "Source rollback failed; original commit is ${old_sha}."
      fi
    fi
  }

  cleanup_application_update() {
    if (( update_success == 0 )); then rollback_application; fi
    git -C "$SPARK_ROOT" worktree remove --force "$stage" >/dev/null 2>&1 || true
    rm -rf "$stage" "$frontend_next" "$modules_next" "$functions_next"
    if (( update_success == 1 || functions_switched == 0 )); then rm -rf "$functions_prev"; fi
    if (( update_success == 1 )); then
      rm -rf "$frontend_prev" "$modules_prev"
    else
      (( frontend_switched == 0 )) && rm -rf "$frontend_prev"
      (( modules_switched == 0 )) && rm -rf "$modules_prev"
    fi
  }

  handle_application_signal() {
    rollback_application
    exit 130
  }

  trap cleanup_application_update EXIT
  trap handle_application_signal INT TERM

  rm -rf "$stage" "$frontend_next" "$frontend_prev" "$modules_next" "$modules_prev"

  run_logged "Create temporary application worktree" \
    git -C "$SPARK_ROOT" worktree add --detach "$stage" "$target_sha" || return 1

  run_logged "Prepare production frontend environment" \
    application_prepare_frontend_env "$stage" || return 1

  run_logged "Install application dependencies with npm ci" \
    bash -c "cd '$stage' && npm ci" || return 1

  run_logged "Build application with npm run build" \
    bash -c "cd '$stage' && npm run build" || return 1

  run_logged "Validate application build" \
    application_validate_frontend_build "$stage" || return 1

  functions_next="$(mktemp -d "${functions_live}.next.XXXXXXXX")" || return 1
  functions_prev="${functions_next}.previous"
  run_logged "Stage all Edge Functions and router from the application commit" \
    application_stage_functions "$stage" "$functions_next" "$functions_live" || return 1

  mkdir -p "$modules_next"
  run_logged "Stage active application dependencies" \
    rsync -a --delete "${stage}/node_modules/" "${modules_next}/" || return 1

  mkdir -p "$frontend_next"
  rsync -a --delete "${stage}/dist/" "${frontend_next}/" >>"$CURRENT_LOG" 2>&1 || return 1
  [[ -f "${frontend_next}/index.html" ]] || { fail "Application staging is missing index.html."; return 1; }
  chown -R www-data:www-data "$frontend_next" || return 1

  run_logged "Replace application source with fetched origin/main" \
    git -C "$SPARK_ROOT" reset --hard "$target_sha" || return 1
  source_advanced=1

  if ! mv "$functions_live" "$functions_prev"; then
    fail "Unable to retain the previous Functions tree."
    return 1
  fi
  functions_switched=1
  if ! mv "$functions_next" "$functions_live"; then
    rollback_application
    fail "Unable to activate the new Functions tree."
    return 1
  fi
  if ! run_logged "Restart existing Functions runtime" docker restart "$functions_container"; then
    rollback_application
    return 1
  fi
  if ! run_logged "Validate Functions runtime and SMS handler startup (OPTIONS only)" \
    application_functions_health "$functions_container"; then
    rollback_application
    return 1
  fi

  if [[ -d "${SPARK_ROOT}/node_modules" ]]; then
    mv "${SPARK_ROOT}/node_modules" "$modules_prev" || {
      rollback_application
      fail "Unable to stage previous application dependencies for rollback."
      return 1
    }
  fi
  modules_switched=1
  if ! mv "$modules_next" "${SPARK_ROOT}/node_modules"; then
    rollback_application
    fail "Unable to activate application dependencies."
    return 1
  fi

  if [[ -d /var/www/spark ]]; then
    mv /var/www/spark "$frontend_prev" || {
      rollback_application
      fail "Unable to stage previous frontend for application rollback."
      return 1
    }
  fi

  frontend_switched=1
  if ! mv "$frontend_next" /var/www/spark; then
    rollback_application
    fail "Unable to activate new application frontend."
    return 1
  fi
  chown -R www-data:www-data /var/www/spark || {
    rollback_application
    return 1
  }

  if ! run_logged "Validate deployed application frontend" application_frontend_health; then
    rollback_application
    return 1
  fi

  update_success=1
  rm -rf "$frontend_prev" "$modules_prev" "$functions_prev"
  frontend_switched=0
  modules_switched=0
  functions_switched=0
  if declare -F application_record_active_version >/dev/null 2>&1; then
    application_record_active_version "internet" "$target_sha"
  fi

  ok "Internet App update completed: frontend and all Edge Functions deployed. Database, migrations, runtime images, other workers, schedulers and Manager were not changed."
  printf 'Application commit: %s\n' "$(git -C "$SPARK_ROOT" rev-parse HEAD)"
  printf 'Functions commit: %s\n' "$target_sha"
  printf 'Log: %s\n' "$CURRENT_LOG"
)
