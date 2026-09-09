# Compatibility fix for external-WAF Nginx generation.
# Some base Nginx configurations already define `server_tokens off` in the
# surrounding http context. Re-declaring it at the top level of an included
# site file causes nginx -t to fail with "directive is duplicate".

if declare -F airgap_waf_write_nginx_production >/dev/null 2>&1; then
  eval "$(declare -f airgap_waf_write_nginx_production | sed '1s/airgap_waf_write_nginx_production/airgap_waf_write_nginx_production_with_duplicate_server_tokens/')"

  airgap_waf_write_nginx_production() {
    airgap_waf_write_nginx_production_with_duplicate_server_tokens "$@" || return 1

    local site=/etc/nginx/sites-available/spark
    [[ -f "$site" ]] || { fail "External-WAF Nginx site was not generated: $site"; return 1; }

    # server_tokens is already managed globally by Spark/Nginx hardening. Keep
    # the generated WAF site free of a second directive in the same http scope.
    sed -i -E '/^[[:space:]]*server_tokens[[:space:]]+off;[[:space:]]*$/d' "$site"
  }
fi
