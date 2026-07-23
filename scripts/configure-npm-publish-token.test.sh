#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${REPO_ROOT}/scripts/configure-npm-publish-token.sh"
TEMPORARY="$(mktemp -d)"
case "${TEMPORARY}" in
  /tmp/*|/var/folders/*) ;;
  *) echo "Diretório temporário inesperado: ${TEMPORARY}" >&2; exit 1 ;;
esac
trap 'rm -rf "${TEMPORARY}"' EXIT

mkdir -p "${TEMPORARY}/bin"

cat > "${TEMPORARY}/bin/npm" <<'MOCK_NPM'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "view" ]]; then
  if [[ -f "${MOCK_STATE}/published" ]]; then
    printf '"0.1.2"\n'
    exit 0
  fi
  echo "npm error code E404" >&2
  exit 1
fi

if [[ "$1" == "publish" ]]; then
  printf called > "${MOCK_STATE}/publish-called"
  if [[ "${MOCK_MODE:-success}" == "publish-rejected" ]]; then
    echo "npm error code E403" >&2
    exit 1
  fi
  env | grep -Fqx \
    'npm_config_//registry.npmjs.org/:_authToken=npm_test_bootstrap_token_1234567890'
  printf published > "${MOCK_STATE}/published"
  exit 0
fi

if [[ "$1" == "whoami" ]]; then
  if [[ "${MOCK_MODE:-success}" == "login-required" && ! -f "${MOCK_STATE}/logged-in" ]] ||
    [[ "${MOCK_MODE:-success}" == "login-rejected" ]]; then
    printf 'otheruser\n'
  else
    printf 'osvaldoandrade\n'
  fi
  exit 0
fi

if [[ "$1" == "login" ]]; then
  printf called > "${MOCK_STATE}/login-called"
  if [[ "${MOCK_MODE:-success}" == "login-rejected" ]]; then
    echo "npm error code E401" >&2
    exit 1
  fi
  printf authenticated > "${MOCK_STATE}/logged-in"
  exit 0
fi

if [[ "$1 $2 $3" == "org ls code-company" ]]; then
  if [[ "$4" == "osvaldoandrade" ]]; then
    printf '{"osvaldoandrade":"owner"}\n'
  else
    printf '{}\n'
  fi
  exit 0
fi

if [[ "$1 $2 $3" == "team ls code-company:developers" ]]; then
  printf '["osvaldoandrade"]\n'
  exit 0
fi

if [[ "$1 $2" == "token list" ]]; then
  if [[ -f "${MOCK_STATE}/bootstrap-token" ]]; then
    printf '[{"name":"pulsetray-bootstrap","key":"bootstrap-key"}]\n'
  else
    printf '[]\n'
  fi
  exit 0
fi

if [[ "$1 $2" == "token revoke" ]]; then
  [[ "$3" == "bootstrap-key" ]]
  if [[ -z "${NPM_CONFIG_OTP:-}" ]]; then
    echo "npm notice Please check your email for a one-time password" >&2
    echo "npm error code EOTP" >&2
    exit 1
  fi
  [[ "${NPM_CONFIG_OTP}" == "333333" ]]
  rm -f "${MOCK_STATE}/bootstrap-token"
  printf x >> "${MOCK_STATE}/bootstrap-revoked"
  printf '["bootstrap-key"]\n'
  exit 0
fi

[[ "$1 $2" == "token create" ]]
arguments=" $* "

if [[ "${arguments}" == *" --scopes @code-company "* ]]; then
  if [[ "${MOCK_MODE:-success}" == "bootstrap-rejected" ]]; then
    echo "npm error code E401" >&2
    exit 1
  fi
  if [[ -z "${NPM_CONFIG_OTP:-}" ]]; then
    echo "npm notice Please check your email for a one-time password" >&2
    echo "npm error code EOTP" >&2
    exit 1
  fi
  [[ "${NPM_CONFIG_PASSWORD:-}" == "test password" ]]
  [[ "${NPM_CONFIG_OTP}" == "111111" ]]
  printf created > "${MOCK_STATE}/bootstrap-token"
  printf 'npm notice token created\n{\n  "token": "npm_test_bootstrap_token_1234567890",\n  "permissions": [{"name": "package", "action": "write"}],\n  "scopes": [{"name": "@code-company", "type": "package"}]\n}\n'
  exit 0
fi

[[ "${arguments}" == *" --packages @code-company/pulsetray "* ]]
[[ -f "${MOCK_STATE}/published" ]]
if [[ "${MOCK_MODE:-success}" == "token-rejected" ]]; then
  echo "npm error code E401" >&2
  exit 1
fi
if [[ -z "${NPM_CONFIG_OTP:-}" ]]; then
  echo "npm notice Please check your email for a one-time password" >&2
  echo "npm error code EOTP" >&2
  exit 1
fi
[[ "${NPM_CONFIG_PASSWORD:-}" == "test password" ]]
[[ "${NPM_CONFIG_OTP}" == "222222" ]]
if [[ "${MOCK_MODE:-success}" == "malformed" ]]; then
  echo "npm password: not-json"
  exit 0
fi
printf 'npm notice token created\n{\n  "token": "npm_test_publish_token_1234567890",\n  "permissions": [{"name": "package", "action": "write"}],\n  "scopes": [{"name": "@code-company/pulsetray", "type": "package"}]\n}\n'
MOCK_NPM

cat > "${TEMPORARY}/bin/gh" <<'MOCK_GH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1 $2" == "release view" ]]; then
  printf 'true\n'
  exit 0
fi
if [[ "$1 $2" == "secret set" ]]; then
  token="$(cat)"
  printf called > "${MOCK_STATE}/gh-called"
  [[ "${token}" == "npm_test_publish_token_1234567890" ]]
  printf configured > "${MOCK_STATE}/configured"
  exit 0
fi
if [[ "$1 $2" == "secret list" && -f "${MOCK_STATE}/configured" ]]; then
  printf 'NPM_TOKEN\t2026-07-23T19:00:00Z\n'
  exit 0
fi
exit 1
MOCK_GH

chmod 755 "${TEMPORARY}/bin/npm" "${TEMPORARY}/bin/gh"

run_case() {
  local mode="$1"
  local state="${TEMPORARY}/${mode}"
  mkdir -p "${state}"
  if [[ "${mode}" == "existing" ]]; then
    printf published > "${state}/published"
    printf 'test password\n222222\n' |
      env PATH="${TEMPORARY}/bin:${PATH}" MOCK_MODE="success" MOCK_STATE="${state}" \
        bash "${SCRIPT}"
    return
  fi
  if [[ "${mode}" == "stale" ]]; then
    printf created > "${state}/bootstrap-token"
    printf 'test password\n333333\n111111\n333333\n222222\n' |
      env PATH="${TEMPORARY}/bin:${PATH}" MOCK_MODE="${mode}" MOCK_STATE="${state}" \
        bash "${SCRIPT}"
    return
  fi
  printf 'test password\n111111\n333333\n222222\n' |
    env PATH="${TEMPORARY}/bin:${PATH}" MOCK_MODE="${mode}" MOCK_STATE="${state}" \
      bash "${SCRIPT}"
}

run_case success | grep -q "NPM_TOKEN configurado no GitHub."
[[ -e "${TEMPORARY}/success/publish-called" ]]
[[ -e "${TEMPORARY}/success/bootstrap-revoked" ]]

run_case stale | grep -q "NPM_TOKEN configurado no GitHub."
[[ "$(wc -c < "${TEMPORARY}/stale/bootstrap-revoked" | tr -d ' ')" == "2" ]]

run_case existing | grep -q "NPM_TOKEN configurado no GitHub."
[[ ! -e "${TEMPORARY}/existing/publish-called" ]]

if run_case malformed >/dev/null 2>&1; then
  echo "Resposta malformada deveria falhar." >&2
  exit 1
fi
[[ ! -e "${TEMPORARY}/malformed/gh-called" ]]

run_case login-required | grep -q "NPM_TOKEN configurado no GitHub."
[[ -e "${TEMPORARY}/login-required/login-called" ]]

if run_case login-rejected >/dev/null 2>&1; then
  echo "Falha no login correto deveria impedir a publicação." >&2
  exit 1
fi
[[ ! -e "${TEMPORARY}/login-rejected/publish-called" ]]

if run_case bootstrap-rejected >/dev/null 2>&1; then
  echo "Falha ao criar token temporário deveria impedir a publicação." >&2
  exit 1
fi
[[ ! -e "${TEMPORARY}/bootstrap-rejected/publish-called" ]]

if run_case token-rejected >/dev/null 2>&1; then
  echo "Falha ao criar token definitivo deveria impedir o secret." >&2
  exit 1
fi
[[ ! -e "${TEMPORARY}/token-rejected/gh-called" ]]
[[ -e "${TEMPORARY}/token-rejected/bootstrap-revoked" ]]

if run_case publish-rejected >/dev/null 2>&1; then
  echo "Falha ao publicar deveria impedir a atualização do secret." >&2
  exit 1
fi
[[ ! -e "${TEMPORARY}/publish-rejected/gh-called" ]]
[[ -e "${TEMPORARY}/publish-rejected/bootstrap-revoked" ]]

echo "Credential bootstrap tests passed."
