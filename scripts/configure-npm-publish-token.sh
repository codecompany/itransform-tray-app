#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${REPO_ROOT}/npm-package"
PACKAGE_NAME="@code-company/pulsetray"
GITHUB_REPOSITORY="codecompany/itransform-tray-app"
NPM_ORG="code-company"
NPM_TEAM="${NPM_ORG}:developers"
PACKAGE_SCOPE="@${NPM_ORG}"
BOOTSTRAP_TOKEN_NAME="pulsetray-bootstrap"
PUBLISH_TOKEN_NAME="pulsetray-github-actions"

cleanup() {
  unset package_lookup package_version publish_response publish_error
  unset bootstrap_token npm_password token_otp token_response created_token npm_token
  unset npm_user npm_role npm_team_member
}
trap cleanup EXIT

npm_error_code() {
  printf "%s\n" "$1" |
    sed -n 's/^npm error code //p' |
    tail -n 1
}

extract_token() {
  node -e '
    const fs = require("node:fs");
    const response = fs.readFileSync(0, "utf8");
    for (let start = response.indexOf("{"); start >= 0; start = response.indexOf("{", start + 1)) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let end = start; end < response.length; end += 1) {
        const character = response[end];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (character === "\\") {
            escaped = true;
          } else if (character === "\"") {
            inString = false;
          }
          continue;
        }
        if (character === "\"") {
          inString = true;
        } else if (character === "{") {
          depth += 1;
        } else if (character === "}") {
          depth -= 1;
          if (depth === 0) {
            try {
              const result = JSON.parse(response.slice(start, end + 1));
              if (typeof result.token === "string") {
                process.stdout.write(result.token);
                process.exit(0);
              }
            } catch {}
            break;
          }
        }
      }
    }
    process.exit(1);
  '
}

load_scope_access() {
  local role_response
  local team_response

  role_response="$(
    npm org ls "${NPM_ORG}" "${npm_user}" --json 2>/dev/null || printf '{}'
  )"
  npm_role="$(
    printf "%s" "${role_response}" |
      node -e '
        const fs = require("node:fs");
        const user = process.argv[1];
        const roles = JSON.parse(fs.readFileSync(0, "utf8"));
        process.stdout.write(typeof roles[user] === "string" ? roles[user] : "");
      ' "${npm_user}"
  )"
  team_response="$(
    npm team ls "${NPM_TEAM}" --json 2>/dev/null || printf '[]'
  )"
  npm_team_member="$(
    printf "%s" "${team_response}" |
      node -e '
        const fs = require("node:fs");
        const user = process.argv[1];
        const users = JSON.parse(fs.readFileSync(0, "utf8"));
        process.stdout.write(String(users.includes(user)));
      ' "${npm_user}"
  )"
}

ensure_scope_identity() {
  npm_user="$(npm whoami 2>/dev/null || true)"
  load_scope_access

  if [[ -z "${npm_role}" || "${npm_team_member}" != "true" ]]; then
    echo "A sessão npm precisa de acesso a ${PACKAGE_SCOPE}; abrindo o login no navegador."
    npm login --auth-type=web || {
      echo "O login npm não foi concluído." >&2
      return 1
    }
    npm_user="$(npm whoami 2>/dev/null || true)"
    load_scope_access
  fi

  if [[ -z "${npm_role}" || "${npm_team_member}" != "true" ]]; then
    echo "A conta autenticada não pode publicar em ${PACKAGE_SCOPE}; nenhuma publicação foi iniciada." >&2
    return 1
  fi

  echo "Acesso npm confirmado: ${npm_user} (${npm_role}) em ${PACKAGE_SCOPE}."
}

create_npm_token() {
  local token_name="$1"
  local token_access="$2"
  local token_expiry="$3"
  local otp_purpose="$4"
  local create_status
  local error_code
  local token_args=(
    token create
    --name "${token_name}"
    --expires "${token_expiry}"
    --packages-and-scopes-permission read-write
    --bypass-2fa
    --json
  )

  if [[ "${token_access}" == "scope" ]]; then
    token_args+=(--scopes "${PACKAGE_SCOPE}")
  else
    token_args+=(--packages "${PACKAGE_NAME}")
  fi

  set +e
  token_response="$(
    NPM_CONFIG_PASSWORD="${npm_password}" npm "${token_args[@]}" 2>&1
  )"
  create_status=$?
  set -e

  if [[ "${create_status}" -ne 0 ]]; then
    error_code="$(npm_error_code "${token_response}")"
    if [[ "${token_response}" != *"EOTP"* ]]; then
      echo "O npm recusou a criação de ${token_name} (${error_code:-erro npm})." >&2
      return "${create_status}"
    fi

    echo "O npm enviou um OTP para ${otp_purpose}."
    read -r -s -p "OTP: " token_otp
    echo
    [[ "${token_otp}" =~ ^[0-9]{6,8}$ ]] || {
      echo "OTP inválido." >&2
      return 1
    }

    set +e
    token_response="$(
      NPM_CONFIG_PASSWORD="${npm_password}" NPM_CONFIG_OTP="${token_otp}" \
        npm "${token_args[@]}" 2>&1
    )"
    create_status=$?
    set -e
    if [[ "${create_status}" -ne 0 ]]; then
      error_code="$(npm_error_code "${token_response}")"
      echo "O npm recusou a criação de ${token_name} (${error_code:-erro npm})." >&2
      return "${create_status}"
    fi
  fi

  created_token="$(printf "%s" "${token_response}" | extract_token)" || {
    echo "O npm retornou uma resposta de token inválida." >&2
    if [[ "${token_name}" == "${BOOTSTRAP_TOKEN_NAME}" ]]; then
      revoke_bootstrap_tokens || {
        echo "Revogue manualmente o token ${BOOTSTRAP_TOKEN_NAME} no npm." >&2
      }
    fi
    return 1
  }
  [[ "${created_token}" == npm_* && "${#created_token}" -ge 20 ]] || {
    echo "O npm retornou um token inválido." >&2
    return 1
  }

  unset token_otp token_response
}

revoke_bootstrap_tokens() {
  local token_list
  local list_status
  local token_keys_text
  local token_key
  local revoke_response
  local revoke_status
  local revoke_otp
  local error_code
  local token_keys=()

  set +e
  token_list="$(npm token list --json 2>&1)"
  list_status=$?
  set -e
  if [[ "${list_status}" -ne 0 ]]; then
    error_code="$(npm_error_code "${token_list}")"
    echo "Não foi possível localizar o token temporário (${error_code:-erro npm})." >&2
    return "${list_status}"
  fi

  token_keys_text="$(
    printf "%s" "${token_list}" |
      node -e '
        const fs = require("node:fs");
        const name = process.argv[1];
        const tokens = JSON.parse(fs.readFileSync(0, "utf8"));
        const keys = tokens
          .filter((token) => token.name === name && typeof token.key === "string")
          .map((token) => token.key);
        process.stdout.write(keys.join("\n"));
      ' "${BOOTSTRAP_TOKEN_NAME}"
  )" || {
    echo "A lista de tokens retornada pelo npm é inválida." >&2
    return 1
  }
  unset token_list

  [[ -n "${token_keys_text}" ]] || return 0
  while IFS= read -r token_key; do
    [[ -n "${token_key}" ]] && token_keys+=("${token_key}")
  done <<< "${token_keys_text}"
  unset token_keys_text

  set +e
  revoke_response="$(npm token revoke "${token_keys[@]}" --json 2>&1)"
  revoke_status=$?
  set -e

  if [[ "${revoke_status}" -ne 0 ]]; then
    error_code="$(npm_error_code "${revoke_response}")"
    if [[ "${revoke_response}" != *"EOTP"* ]]; then
      echo "O npm recusou a revogação do token temporário (${error_code:-erro npm})." >&2
      return "${revoke_status}"
    fi

    echo "O npm enviou um OTP para revogar o token temporário."
    read -r -s -p "OTP: " revoke_otp
    echo
    [[ "${revoke_otp}" =~ ^[0-9]{6,8}$ ]] || {
      echo "OTP inválido." >&2
      return 1
    }

    set +e
    revoke_response="$(
      NPM_CONFIG_OTP="${revoke_otp}" npm token revoke "${token_keys[@]}" --json 2>&1
    )"
    revoke_status=$?
    set -e
    if [[ "${revoke_status}" -ne 0 ]]; then
      error_code="$(npm_error_code "${revoke_response}")"
      echo "O npm recusou a revogação do token temporário (${error_code:-erro npm})." >&2
      return "${revoke_status}"
    fi
  fi

  unset revoke_otp revoke_response bootstrap_token
  echo "Token temporário revogado."
}

command -v npm >/dev/null || {
  echo "npm não encontrado." >&2
  exit 1
}
command -v gh >/dev/null || {
  echo "gh não encontrado." >&2
  exit 1
}
command -v node >/dev/null || {
  echo "node não encontrado." >&2
  exit 1
}

package_version="$(
  node -e '
    const manifest = require(process.argv[1]);
    if (manifest.name !== process.argv[2] || typeof manifest.version !== "string") {
      process.exit(1);
    }
    process.stdout.write(manifest.version);
  ' "${PACKAGE_DIR}/package.json" "${PACKAGE_NAME}"
)" || {
  echo "O manifesto do pacote npm é inválido." >&2
  exit 1
}

gh release view "v${package_version}" \
  --repo "${GITHUB_REPOSITORY}" \
  --json isDraft,assets \
  --jq '(.isDraft == false) and ([.assets[].name] | index("SHA256SUMS.txt") != null)' |
  grep -qx true || {
    echo "A GitHub Release v${package_version} não está pronta para publicação npm." >&2
    exit 1
  }

set +e
package_lookup="$(npm view "${PACKAGE_NAME}@${package_version}" version --json 2>&1)"
lookup_status=$?
set -e

if [[ "${lookup_status}" -ne 0 && "${package_lookup}" != *"E404"* ]]; then
  echo "Não foi possível consultar ${PACKAGE_NAME} no npm." >&2
  exit "${lookup_status}"
fi

ensure_scope_identity || exit $?

read -r -s -p "Senha npm: " npm_password
echo

if [[ "${lookup_status}" -ne 0 ]]; then
  echo "A versão ${PACKAGE_NAME}@${package_version} ainda não existe no npm."

  revoke_bootstrap_tokens || exit $?

  create_npm_token "${BOOTSTRAP_TOKEN_NAME}" "scope" "1" \
    "autorizar o token temporário de publicação" || exit $?
  bootstrap_token="${created_token}"
  unset created_token

  set +e
  publish_response="$(
    cd "${PACKAGE_DIR}" &&
      env "npm_config_//registry.npmjs.org/:_authToken=${bootstrap_token}" \
        npm publish --access public 2>&1
  )"
  publish_status=$?
  set -e

  if [[ "${publish_status}" -ne 0 ]]; then
    publish_error="$(npm_error_code "${publish_response}")"
    echo "O npm recusou a publicação inicial (${publish_error:-erro npm})." >&2
    revoke_bootstrap_tokens || {
      echo "Revogue manualmente o token ${BOOTSTRAP_TOKEN_NAME} no npm." >&2
    }
    exit "${publish_status}"
  fi

  echo "${PACKAGE_NAME}@${package_version} publicado no npm."
fi

revoke_bootstrap_tokens || exit $?

create_npm_token "${PUBLISH_TOKEN_NAME}" "package" "90" \
  "autorizar o token definitivo do GitHub Actions" || exit $?
npm_token="${created_token}"
unset created_token

printf "%s" "${npm_token}" |
  gh secret set NPM_TOKEN --repo "${GITHUB_REPOSITORY}"

unset package_lookup publish_response bootstrap_token
unset npm_password token_otp token_response npm_token

gh secret list --repo "${GITHUB_REPOSITORY}" |
  grep -q '^NPM_TOKEN' || {
    echo "O secret NPM_TOKEN não foi confirmado no GitHub." >&2
    exit 1
  }

echo "NPM_TOKEN configurado no GitHub."
