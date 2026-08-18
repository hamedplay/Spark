#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SPARK_MANAGER_WRAPPER_VERSION="1.3.3"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  exec sudo -E "$0" "$@"
fi

WRAPPER_SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$WRAPPER_SOURCE" ]]; do
  WRAPPER_SOURCE_DIR="$(cd -P -- "$(dirname -- "$WRAPPER_SOURCE")" >/dev/null 2>&1 && pwd)"
  WRAPPER_TARGET="$(readlink -- "$WRAPPER_SOURCE")"
  if [[ "$WRAPPER_TARGET" == /* ]]; then
    WRAPPER_SOURCE="$WRAPPER_TARGET"
  else
    WRAPPER_SOURCE="${WRAPPER_SOURCE_DIR}/${WRAPPER_TARGET}"
  fi
done
WRAPPER_DIR="$(cd -P -- "$(dirname -- "$WRAPPER_SOURCE")" >/dev/null 2>&1 && pwd)"
BASE_ENTRYPOINT="${WRAPPER_DIR}/spark-base"
unset WRAPPER_SOURCE WRAPPER_SOURCE_DIR WRAPPER_TARGET

if [[ ! -r "$BASE_ENTRYPOINT" ]]; then
  printf 'Spark Manager base entrypoint missing: %s\n' "$BASE_ENTRYPOINT" >&2
  exit 1
fi

set +e +u
exit() { return "${1:-0}"; }
source "$BASE_ENTRYPOINT" --version >/dev/null 2>&1
base_rc=$?
unset -f exit
set -Eeuo pipefail
if (( base_rc != 0 )); then
  printf 'Unable to load Spark Manager base implementation (exit=%d).\n' "$base_rc" >&2
  exit "$base_rc"
fi
unset base_rc

SPARK_MANAGER_VERSION="$SPARK_MANAGER_WRAPPER_VERSION"
SPARK_TUI_DIAG_LOG="${LOG_DIR}/tui-runtime.log"
SPARK_TUI_DEBUG="${SPARK_TUI_DEBUG:-0}"

spark_tui_diag() {
  local message="$*"
  printf '[%s] %s\n' "$(date -Is)" "$message" >>"$SPARK_TUI_DIAG_LOG" 2>/dev/null || true
}

spark_tui_diag_environment() {
  local tty_name term_size
  tty_name="$(tty 2>/dev/null || printf 'not-a-tty')"
  term_size="$(stty size 2>/dev/null || printf 'unknown')"
  spark_tui_diag "session version=${SPARK_MANAGER_VERSION} pid=$$ TERM=${TERM:-unset} COLORTERM=${COLORTERM:-unset} tty=${tty_name} size=${term_size}"
}

# terminal-menus.sh expects the conventional shell IFS (space/tab/newline)
# while Spark intentionally uses newline/tab globally. Keep the compatibility
# boundary inside widget calls so operational functions retain Spark's IFS.
spark_tui_pick() {
  local title_text="$1" message="$2" default_index="$3"
  shift 3
  local result rc saved_ifs="$IFS"

  IFS=$' \t\n'
  set +e +u
  result="$(TUI_MODE="fullscreen" menu "$title_text" "$message" "$default_index" "$@")"
  rc=$?
  set -Eeuo pipefail
  IFS="$saved_ifs"

  (( rc == 0 )) || return "$rc"
  printf '%s' "$result"
}

spark_tui_dispatch_command() {
  local command="${1:-}"
  [[ -n "$command" ]] || return 0
  spark_tui_diag "dispatch command=$(printf '%q' "$command")"

  case "$command" in
    "spark_tui_open install") spark_tui_open install ;;
    "spark_tui_open health") spark_tui_open health ;;
    "spark_tui_open npm") spark_tui_open npm ;;
    "spark_tui_open certs") spark_tui_open certs ;;
    "spark_tui_open backup") spark_tui_open backup ;;
    "spark_tui_open services") spark_tui_open services ;;
    "spark_plain_action update") spark_plain_action update ;;
    "spark_plain_action linux") spark_plain_action linux ;;
    "spark_plain_action resources") spark_plain_action resources ;;
    "spark_plain_action open-admin") spark_plain_action open-admin ;;
    "spark_plain_action close-admin") spark_plain_action close-admin ;;
    "spark_plain_action versions") spark_plain_action versions ;;
    "spark_plain_action manager-update") spark_plain_action manager-update ;;
    "spark_tui_exit") spark_tui_exit ;;
    spark_plain_install_step\ *)
      local step="${command##* }"
      [[ "$step" =~ ^([1-9]|1[0-9]|20|21)$ ]] || {
        fail "Rejected invalid installation step command: $command"
        return 2
      }
      spark_plain_install_step "$step"
      ;;
    *)
      fail "Rejected unknown TUI command: $command"
      return 2
      ;;
  esac
}

main_menu() {
  local saved_ifs="$IFS" config command rc

  IFS=$' \t\n'
  spark_tui_init || { rc=$?; IFS="$saved_ifs"; spark_tui_diag "main init failed rc=${rc}"; return "$rc"; }
  spark_tui_extra_keys
  IFS="$saved_ifs"

  spark_tui_diag_environment

  BACKTITLE="⚡ SPARK SERVER MANAGER · v${SPARK_MANAGER_VERSION} · $(hostname -s 2>/dev/null || hostname)"
  export BACKTITLE
  TUI_PERSISTENT_FILTERS=true
  export TUI_PERSISTENT_FILTERS

  while true; do
    spark_tui_write_main_data
    config="$(spark_tui_main_config)"
    TUI_RESULT=""

    IFS=$' \t\n'
    set +e +u
    TUI_MODE="fullscreen" mainmenu \
      "SPARK CONTROL CENTER" \
      "Production deployment · operations · security · observability" \
      "$config" 1 1 >/dev/null
    rc=$?
    command="${TUI_RESULT:-}"
    set -Eeuo pipefail
    IFS="$saved_ifs"

    spark_tui_diag "mainmenu rc=${rc} result=$(printf '%q' "$command")"
    (( rc == 0 )) || return 0
    [[ -n "$command" ]] || continue
    spark_tui_dispatch_command "$command" || true
  done
}

install_menu() {
  local saved_ifs="$IFS" config command rc

  IFS=$' \t\n'
  spark_tui_init || { rc=$?; IFS="$saved_ifs"; spark_tui_diag "install init failed rc=${rc}"; return "$rc"; }
  spark_tui_extra_keys
  IFS="$saved_ifs"

  BACKTITLE="⚡ SPARK · INSTALLATION · $(hostname -s 2>/dev/null || hostname)"
  export BACKTITLE
  TUI_PERSISTENT_FILTERS=true
  export TUI_PERSISTENT_FILTERS

  while true; do
    spark_tui_write_install_data
    config="$(spark_tui_install_config)"
    TUI_RESULT=""

    IFS=$' \t\n'
    set +e +u
    TUI_MODE="fullscreen" mainmenu \
      "SPARK INSTALLATION" \
      "Guided single-host deployment · completed steps are tracked automatically" \
      "$config" 1 1 >/dev/null
    rc=$?
    command="${TUI_RESULT:-}"
    set -Eeuo pipefail
    IFS="$saved_ifs"

    spark_tui_diag "install-mainmenu rc=${rc} result=$(printf '%q' "$command")"
    (( rc == 0 )) || return 0
    [[ -n "$command" ]] || continue
    spark_tui_dispatch_command "$command" || true
  done
}

install_manager_from_dir() {
  local source_dir="$1"
  local stage backup module
  [[ -f "${source_dir}/spark" ]] || { fail "Spark Manager base entrypoint not found: ${source_dir}/spark"; return 1; }
  [[ -f "${source_dir}/spark-tui.sh" ]] || { fail "Spark Manager TUI wrapper not found: ${source_dir}/spark-tui.sh"; return 1; }
  for module in core install-base install-platform-a install-platform-b install-platform-c tests-backup update admin; do
    [[ -f "${source_dir}/lib/${module}.sh" ]] || { fail "Spark Manager module not found: ${module}.sh"; return 1; }
  done

  bash -n "${source_dir}/spark" || return 1
  bash -n "${source_dir}/spark-tui.sh" || return 1
  for module in "${source_dir}"/lib/*.sh; do bash -n "$module" || return 1; done

  install -d -m 0755 /usr/local/lib
  stage="$(mktemp -d /usr/local/lib/spark-manager.new.XXXXXX)"
  backup="/usr/local/lib/spark-manager.previous.$$"
  install -d -m 0755 "${stage}/lib"
  install -m 0755 "${source_dir}/spark" "${stage}/spark-base"
  install -m 0755 "${source_dir}/spark-tui.sh" "${stage}/spark"
  for module in "${source_dir}"/lib/*.sh; do
    install -m 0644 "$module" "${stage}/lib/$(basename "$module")"
  done

  if [[ -d /usr/local/lib/spark-manager ]]; then
    mv /usr/local/lib/spark-manager "$backup"
  fi
  if ! mv "$stage" /usr/local/lib/spark-manager; then
    [[ -d "$backup" ]] && mv "$backup" /usr/local/lib/spark-manager
    rm -rf "$stage"
    return 1
  fi
  ln -sfn /usr/local/lib/spark-manager/spark "$CLI_PATH"

  if ! "$CLI_PATH" --version >/dev/null 2>&1; then
    rm -f "$CLI_PATH"
    rm -rf /usr/local/lib/spark-manager
    if [[ -d "$backup" ]]; then
      mv "$backup" /usr/local/lib/spark-manager
      ln -sfn /usr/local/lib/spark-manager/spark "$CLI_PATH"
    fi
    return 1
  fi
  rm -rf "$backup"
}

self_update() {
  title
  new_log "manager-self-update"
  local response sha tmp
  response="$(curl -fsSL -H 'Accept: application/vnd.github+json' \
    -H 'Cache-Control: no-cache' \
    "https://api.github.com/repos/hamedplay/Spark/commits/main?nocache=$(date +%s)")" || {
      fail "Unable to resolve the latest Spark Manager revision."
      return 1
    }
  sha="$(printf '%s' "$response" \
    | grep -m1 -Eo '"sha"[[:space:]]*:[[:space:]]*"[0-9a-f]{40}"' \
    | grep -Eo '[0-9a-f]{40}' || true)"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
    fail "GitHub returned an invalid Spark Manager revision."
    return 1
  }

  tmp="$(mktemp)"
  if ! run_logged "Download Spark Manager bootstrap (${sha:0:12})" \
    curl -fsSL -H 'Cache-Control: no-cache' \
      "https://raw.githubusercontent.com/hamedplay/Spark/${sha}/deploy/spark-cli/bootstrap.sh" \
      -o "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  if ! bash -n "$tmp" >>"$CURRENT_LOG" 2>&1; then
    fail "Downloaded bootstrap has invalid syntax."
    rm -f "$tmp"
    return 1
  fi
  if ! run_visible "Install latest Spark Manager" bash "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  rm -f "$tmp"
  ok "Spark Manager updated. Exit and run spark again to load the new version."
}

case "${1:-}" in
  --version|-V)
    printf 'Spark Server Manager %s\n' "$SPARK_MANAGER_VERSION"
    exit 0
    ;;
  --help|-h)
    cat <<EOF_HELP
Usage: spark [option]

Run without an option to open the interactive full-screen control center.

  --version       Show Spark Manager version
  --test          Run full validation
  --update        Update Spark application
  --resources     Show server resource usage
  --debug-tui     Run the TUI and record diagnostic metadata
  --tui-log       Show the latest TUI diagnostic log
EOF_HELP
    exit 0
    ;;
  --test)
    title
    new_log "cli-test"
    run_visible "Full validation" test_full_validation
    ;;
  --update)
    update_spark
    ;;
  --resources)
    resource_status
    ;;
  --debug-tui)
    SPARK_TUI_DEBUG=1
    spark_tui_diag "debug-tui requested"
    main_menu
    ;;
  --tui-log)
    if [[ -f "$SPARK_TUI_DIAG_LOG" ]]; then
      tail -n 250 "$SPARK_TUI_DIAG_LOG"
    else
      printf 'No Spark TUI diagnostic log exists yet: %s\n' "$SPARK_TUI_DIAG_LOG"
    fi
    ;;
  "")
    main_menu
    ;;
  *)
    fail "Unknown option: $1"
    exit 2
    ;;
esac
