/*
 * Airepro Workflow (airepro-workflow / WA-AKG) — Jenkins deploy (Docker Compose).
 *
 * Prerequisites (configure in Jenkins job, credentials, or agent env):
 * - Node.js **20.19.0** required. If the Jenkins NodeJS tool is older, this pipeline
 *   bootstraps Node into the workspace and prepends it to PATH.
 * - Deploy branch: master (override with DEPLOY_BRANCH).
 * - project.json at repo root (slug, frontend_port, backend_port, domain, backend_domain).
 *   DNS / Cloudflare Tunnel must point to localhost:1730.
 * - On the deploy host: FRONTEND_BASE, BACKEND_BASE, NGINX_BIN, NGINX_CONF_DIR, NGINX_ENABLED_DIR
 *   Linux defaults: /var/www/workflow-frontends, /var/www/workflow-backends,
 *   /etc/nginx/sites-available, /usr/sbin/nginx.
 * - Runtime `.env` at `${BACKEND_BASE}/${SLUG}/.env` (bind-mounted into the container).
 * - Secrets: agent file `/home/airepro/.secrets/airepro-workflow.env` (override APP_SECRETS_FILE).
 *   Required keys: DATABASE_URL (mysql://…), AUTH_SECRET (min 32 chars).
 *   Recommended: BASE_URL, NEXTAUTH_URL, NEXT_PUBLIC_APP_URL, ADMIN_EMAIL, ADMIN_PASSWORD,
 *   NEXT_PUBLIC_SWAGGER_PASSWORD.
 * - Uploads: WORKFLOW_UPLOADS_DIR (default /var/lib/workflow/uploads), outside the wiped deploy tree.
 * - Compose image tag: WORKFLOW_IMAGE_TAG (= BUILD_NUMBER). Never use Jenkins BUILD_TAG.
 * - Jenkins user needs passwordless sudo for nginx dirs and docker (or passwordless sudo docker).
 *
 * Layout (single Next.js + Baileys gateway — UI and API share one port):
 * - App: Dockerfile → `workflow-app` → 127.0.0.1:1730
 * - Host nginx :80 is Host-header edge — proxies workflow.airepro.in and workflow-s.airepro.in
 *   to the container (incl. /api/socket/io WebSocket).
 * - Health probe: GET /auth/login (200)
 */

pipeline {
    agent any

    options {
        skipDefaultCheckout(true)
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    tools {
        nodejs 'node js'
    }

    environment {
        DEPLOY_BRANCH = "${env.DEPLOY_BRANCH ?: 'master'}"
        NODE_BOOTSTRAP_VERSION = "${env.NODE_BOOTSTRAP_VERSION ?: '20.19.0'}"
        FRONTEND_BASE = "${env.FRONTEND_BASE ?: '/var/www/workflow-frontends'}"
        BACKEND_BASE  = "${env.BACKEND_BASE ?: '/var/www/workflow-backends'}"
        NGINX_BIN           = "${env.NGINX_BIN ?: '/usr/sbin/nginx'}"
        NGINX_CONF_DIR      = "${env.NGINX_CONF_DIR ?: '/etc/nginx/sites-available'}"
        NGINX_ENABLED_DIR   = "${env.NGINX_ENABLED_DIR ?: '/etc/nginx/sites-enabled'}"
        APP_SECRETS_FILE    = "${env.APP_SECRETS_FILE ?: '/home/airepro/.secrets/airepro-workflow.env'}"
        WORKFLOW_UPLOADS_DIR = "${env.WORKFLOW_UPLOADS_DIR ?: '/var/lib/workflow/uploads'}"
        COMPOSE_PROJECT_NAME = 'workflow'

        JENKINS_NODE_COOKIE = 'dontKillMe'
        BUILD_ID            = 'dontKillMe'
    }

    stages {
        stage('Checkout') {
            steps {
                script {
                    def raw = env.DEPLOY_BRANCH ?: env.BRANCH_NAME ?: env.GIT_BRANCH ?: env.CHANGE_BRANCH ?: 'master'
                    def branch = raw.trim()
                        .replaceFirst('^refs/remotes/origin/', '')
                        .replaceFirst('^refs/heads/', '')
                        .replaceFirst('^origin/', '')
                    echo "Checkout branch: ${branch} (from ${raw})"
                    checkout([
                        $class: 'GitSCM',
                        branches: [[name: "*/${branch}"]],
                        doGenerateSubmoduleConfigurations: false,
                        extensions: [],
                        submoduleCfg: [],
                        userRemoteConfigs: scm.userRemoteConfigs,
                    ])
                }
                sh '''
                set -e
                echo "Deployed commit: $(git rev-parse HEAD)"
                echo "Branch: $(git rev-parse --abbrev-ref HEAD)"
                git log -1 --oneline
                test -f project.json || { echo "ERROR: project.json missing"; ls -la; exit 1; }
                test -f Jenkinsfile || { echo "ERROR: Jenkinsfile missing"; exit 1; }
                test -f docker-compose.yml || { echo "ERROR: docker-compose.yml missing"; exit 1; }
                test -f Dockerfile || { echo "ERROR: Dockerfile missing"; exit 1; }
                '''
            }
        }

        stage('Ensure Node.js 20.19.0') {
            steps {
                sh '''
                    set -e
                    node_version_ok() {
                      node -e "const p=process.versions.node.split('.').map(Number);const ok=(p[0]===20&&p[1]>=19)||p[0]>20;process.exit(ok?0:1)" 2>/dev/null
                    }
                    if [ "${SKIP_NODE_VERSION_CHECK}" = "true" ]; then
                        echo "WARNING: SKIP_NODE_VERSION_CHECK=true — continuing on $(command -v node) -> $(node -v)"
                        exit 0
                    fi
                    if node_version_ok; then
                        echo "Node OK: $(command -v node) -> $(node -v), npm $(npm -v)"
                        exit 0
                    fi
                    echo "Jenkins NodeJS tool is too old: $(command -v node) -> $(node -v). Bootstrapping Node ${NODE_BOOTSTRAP_VERSION}..."
                    NODE_DIR="${WORKSPACE}/.node/${NODE_BOOTSTRAP_VERSION}"
                    NODE_BIN="${NODE_DIR}/bin"
                    if [ ! -x "${NODE_BIN}/node" ]; then
                      case "$(uname -s)-$(uname -m)" in
                        Linux-x86_64|Linux-amd64) NODE_OS=linux; NODE_ARCH=x64 ;;
                        Linux-aarch64|Linux-arm64) NODE_OS=linux; NODE_ARCH=arm64 ;;
                        Darwin-x86_64) NODE_OS=darwin; NODE_ARCH=x64 ;;
                        Darwin-arm64) NODE_OS=darwin; NODE_ARCH=arm64 ;;
                        *)
                          echo "ERROR: Unsupported platform $(uname -s)-$(uname -m) for Node bootstrap"
                          exit 1
                          ;;
                      esac
                      NODE_TARBALL="node-v${NODE_BOOTSTRAP_VERSION}-${NODE_OS}-${NODE_ARCH}.tar.xz"
                      curl -fsSL "https://nodejs.org/dist/v${NODE_BOOTSTRAP_VERSION}/${NODE_TARBALL}" -o "${WORKSPACE}/.node.tar.xz"
                      mkdir -p "${WORKSPACE}/.node"
                      rm -rf "${WORKSPACE}/.node/node-v${NODE_BOOTSTRAP_VERSION}-${NODE_OS}-${NODE_ARCH}"
                      tar -xJf "${WORKSPACE}/.node.tar.xz" -C "${WORKSPACE}/.node"
                      mv "${WORKSPACE}/.node/node-v${NODE_BOOTSTRAP_VERSION}-${NODE_OS}-${NODE_ARCH}" "${NODE_DIR}"
                      rm -f "${WORKSPACE}/.node.tar.xz"
                    fi
                    echo "${NODE_BIN}" > "${WORKSPACE}/.jenkins_node_bin"
                    export PATH="${NODE_BIN}:${PATH}"
                    echo "Using bootstrapped $(command -v node) -> $(node -v), npm $(npm -v)"
                    node_version_ok || { echo "ERROR: Bootstrap failed"; exit 1; }
                '''
                script {
                    if (fileExists('.jenkins_node_bin')) {
                        def nodeBin = readFile('.jenkins_node_bin').trim()
                        env.PATH = "${nodeBin}:${env.PATH}"
                        echo "PATH: using Node from ${nodeBin}"
                    }
                }
            }
        }

        stage('Read project.json') {
            steps {
                script {
                    def config = readJSON file: 'project.json'
                    env.SLUG = "${config.slug}"
                    env.DOMAIN = "${config.domain}"
                    env.BACKEND_DOMAIN = "${config.backend_domain}"
                    env.FRONTEND_PORT = "${config.frontend_port ?: 1730}"
                    env.BACKEND_PORT = "${config.backend_port ?: config.frontend_port ?: 1730}"
                    env.APP_PORT = env.FRONTEND_PORT
                    echo "project.json -> slug=${env.SLUG} port=${env.APP_PORT} domain=${env.DOMAIN} api=${env.BACKEND_DOMAIN}"
                }
            }
        }

        stage('Load deploy secrets') {
            steps {
                sh '''
                set +x
                SECRETS_FILE="${APP_SECRETS_FILE:-/home/airepro/.secrets/airepro-workflow.env}"
                for candidate in \
                  "${SECRETS_FILE}" \
                  "${HOME}/.secrets/airepro-workflow.env" \
                  "/var/lib/jenkins/.secrets/airepro-workflow.env" \
                  "/home/airepro/.secrets/airepro-workflow.env"; do
                  if [ -n "${candidate}" ] && [ -f "${candidate}" ]; then
                    SECRETS_FILE="${candidate}"
                    break
                  fi
                done
                if [ ! -f "${SECRETS_FILE}" ]; then
                  if [ "${ALLOW_MISSING_SECRETS_FILE:-}" = "true" ]; then
                    echo "WARNING: secrets file ${SECRETS_FILE} not found — ALLOW_MISSING_SECRETS_FILE=true, continuing"
                    exit 0
                  fi
                  echo "ERROR: secrets file missing: ${SECRETS_FILE}"
                  echo "Create /home/airepro/.secrets/airepro-workflow.env with DATABASE_URL and AUTH_SECRET."
                  echo "Emergency bypass: ALLOW_MISSING_SECRETS_FILE=true"
                  exit 1
                fi
                umask 077
                grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "${SECRETS_FILE}" \
                  | sed -E 's/^[[:space:]]*export[[:space:]]+//' \
                  > "${WORKSPACE}/.jenkins_deploy_env" || true
                chmod 600 "${WORKSPACE}/.jenkins_deploy_env"
                KEY_COUNT=$(wc -l < "${WORKSPACE}/.jenkins_deploy_env" | tr -d ' ')
                if [ "${KEY_COUNT}" -lt 1 ]; then
                  echo "ERROR: ${SECRETS_FILE} has no KEY=value lines"
                  exit 1
                fi
                echo "Deploy secrets staged from ${SECRETS_FILE} (${KEY_COUNT} keys)"
                for key in DATABASE_URL AUTH_SECRET; do
                  if ! grep -q "^${key}=" "${WORKSPACE}/.jenkins_deploy_env"; then
                    echo "WARNING: ${key} missing from airepro-workflow.env — deploy may fail later"
                  fi
                done
                '''
            }
        }

        stage('Quality gate') {
            steps {
                sh '''
                set -e
                npm ci --legacy-peer-deps
                export DATABASE_URL="${DATABASE_URL:-mysql://ci:ci@127.0.0.1:3306/ci}"
                npx prisma generate
                npm run lint || echo "WARNING: lint reported issues — continuing deploy"
                # Full next build happens inside the Docker image; skip host build to save agent time.
                '''
            }
        }

        stage('Create base directories') {
            steps {
                sh '''
                sudo mkdir -p "${FRONTEND_BASE}"
                sudo mkdir -p "${BACKEND_BASE}"
                sudo mkdir -p "${NGINX_CONF_DIR}"
                sudo mkdir -p "${NGINX_ENABLED_DIR}"
                sudo mkdir -p "${WORKFLOW_UPLOADS_DIR}"
                '''
            }
        }

        stage('Build app image') {
            steps {
                sh '''
                set -e
                docker_cmd() {
                  if docker info >/dev/null 2>&1; then
                    docker "$@"
                  elif sudo -n docker info >/dev/null 2>&1; then
                    sudo -n docker "$@"
                  else
                    echo "ERROR: docker unavailable on this agent" >&2
                    return 1
                  fi
                }

                docker_cmd build \
                  -f Dockerfile \
                  -t "workflow-app:${BUILD_NUMBER}" \
                  -t "workflow-app:latest" \
                  .

                echo "Built workflow-app:${BUILD_NUMBER}"
                docker_cmd images "workflow-app:${BUILD_NUMBER}" --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}'
                '''
            }
        }

        stage('Generate and enable Nginx config') {
            steps {
                script {
                    def conf = """server {
    listen 80;
    server_name ${env.DOMAIN};

    client_max_body_size 50m;

    location /api/socket/io {
        proxy_pass http://127.0.0.1:${env.APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://127.0.0.1:${env.APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}

server {
    listen 80;
    server_name ${env.BACKEND_DOMAIN};

    client_max_body_size 50m;

    location /api/socket/io {
        proxy_pass http://127.0.0.1:${env.APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://127.0.0.1:${env.APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
"""
                    writeFile file: "jenkins-nginx-${env.SLUG}.conf", text: conf
                }
                sh '''
                set -e
                CONF_SRC="${WORKSPACE}/jenkins-nginx-${SLUG}.conf"
                sudo mkdir -p "${NGINX_CONF_DIR}" "${NGINX_ENABLED_DIR}"
                sudo tee "${NGINX_CONF_DIR}/${SLUG}.conf" < "${CONF_SRC}" > /dev/null
                sudo chmod 644 "${NGINX_CONF_DIR}/${SLUG}.conf"
                rm -f "${CONF_SRC}"
                sudo ln -sf "${NGINX_CONF_DIR}/${SLUG}.conf" "${NGINX_ENABLED_DIR}/${SLUG}.conf"
                sudo "${NGINX_BIN}" -t

                nginx_running() {
                    if command -v pgrep >/dev/null 2>&1 && pgrep -x nginx >/dev/null 2>&1; then
                        return 0
                    fi
                    for pidfile in /run/nginx.pid /var/run/nginx.pid /opt/homebrew/var/run/nginx.pid; do
                        if [ -f "${pidfile}" ] && sudo kill -0 "$(cat "${pidfile}")" 2>/dev/null; then
                            return 0
                        fi
                    done
                    return 1
                }
                if nginx_running; then
                    sudo "${NGINX_BIN}" -s reload
                else
                    sudo "${NGINX_BIN}"
                fi
                '''
            }
        }

        stage('Free Production Ports') {
            steps {
                sh '''
                echo "Retiring previous workflow runtime..."

                docker_cmd() {
                  if docker info >/dev/null 2>&1; then
                    docker "$@"
                  elif sudo -n docker info >/dev/null 2>&1; then
                    sudo -n docker "$@"
                  else
                    return 1
                  fi
                }

                npx pm2 delete "${SLUG}" 2>/dev/null || true
                npx pm2 delete wa-akg 2>/dev/null || true
                npx pm2 delete "${SLUG}-backend" 2>/dev/null || true
                npx pm2 delete "${SLUG}-frontend" 2>/dev/null || true

                sudo rm -rf "${WORKSPACE}/.env" 2>/dev/null || true

                (cd "${WORKSPACE}" && docker_cmd compose -f docker-compose.yml down --remove-orphans) 2>/dev/null || true
                docker_cmd rm -f workflow-app >/dev/null 2>&1 || true

                for port in "${APP_PORT}" "${FRONTEND_PORT}" "${BACKEND_PORT}"; do
                  [ -z "${port}" ] && continue
                  holder=$(sudo fuser -n tcp "${port}" 2>/dev/null | tr -s ' ' '\\n' | grep -E '^[0-9]+$' | head -n1 || true)
                  if [ -z "${holder}" ]; then
                    echo "Port ${port} is clear."
                    continue
                  fi
                  pname=$(ps -o comm= -p "${holder}" 2>/dev/null | tr -d ' ' || true)
                  if [ "${pname}" = "nginx" ]; then
                    echo "ERROR: port ${port} is held by nginx (pid ${holder}). Refusing to kill nginx."
                    exit 1
                  fi
                  echo "Port ${port} held by ${pname:-unknown} (pid ${holder}) — killing stray"
                  sudo fuser -k -9 -n tcp "${port}" 2>/dev/null || true
                done
                '''
            }
        }

        stage('Prepare deployment folders') {
            steps {
                sh '''
                set -e
                mkdir -p "${HOME}/.secrets"

                sudo mkdir -p "${FRONTEND_BASE}/${SLUG}"
                sudo mkdir -p "${BACKEND_BASE}/${SLUG}"
                sudo chown -R "$(id -un):$(id -gn)" "${FRONTEND_BASE}/${SLUG}" "${BACKEND_BASE}/${SLUG}"

                sudo mkdir -p "${WORKFLOW_UPLOADS_DIR}"
                sudo chown -R "$(id -un):$(id -gn)" "${WORKFLOW_UPLOADS_DIR}" 2>/dev/null || true

                DEST_ENV="${BACKEND_BASE}/${SLUG}/.env"
                STAGED_ENV="${WORKSPACE}/.jenkins_deploy_env"
                SECRETS_FILE="${APP_SECRETS_FILE:-/home/airepro/.secrets/airepro-workflow.env}"

                umask 077
                if [ -f "${STAGED_ENV}" ]; then
                  cp "${STAGED_ENV}" "${DEST_ENV}"
                  echo "Installed deploy .env from staged secrets"
                elif [ -f "${SECRETS_FILE}" ]; then
                  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "${SECRETS_FILE}" \
                    | sed -E 's/^[[:space:]]*export[[:space:]]+//' \
                    > "${DEST_ENV}"
                  echo "Installed deploy .env from ${SECRETS_FILE}"
                else
                  if [ "${ALLOW_MISSING_SECRETS_FILE:-}" = "true" ]; then
                    echo "WARNING: no secrets — deploy .env not seeded"
                    exit 0
                  fi
                  echo "ERROR: cannot install deploy .env — missing secrets"
                  exit 1
                fi

                # Overlay runtime ports / public URLs for this host
                set_kv() {
                  local key="$1"
                  local val="$2"
                  if grep -q "^${key}=" "${DEST_ENV}" 2>/dev/null; then
                    sed -i "s|^${key}=.*|${key}=${val}|" "${DEST_ENV}"
                  else
                    echo "${key}=${val}" >> "${DEST_ENV}"
                  fi
                }

                set_kv PORT "${APP_PORT}"
                set_kv HOSTNAME "0.0.0.0"
                set_kv NODE_ENV "production"
                set_kv BASE_URL "https://${DOMAIN}"
                set_kv NEXTAUTH_URL "https://${DOMAIN}"
                set_kv NEXT_PUBLIC_APP_URL "https://${DOMAIN}"
                set_kv NEXT_PUBLIC_API_URL "https://${DOMAIN}/api"
                set_kv AUTH_TRUST_HOST "true"

                # Soft-validate DATABASE_URL
                if grep -q '^DATABASE_URL=' "${DEST_ENV}"; then
                  DB_URL=$(grep -E '^DATABASE_URL=' "${DEST_ENV}" | head -n1 | cut -d= -f2- | tr -d '"' | tr -d "'")
                  case "${DB_URL}" in
                    mysql://*) ;;
                    *)
                      echo "ERROR: DATABASE_URL must be mysql://"
                      exit 1
                      ;;
                  esac
                  if echo "${DB_URL}" | grep -qE '@(127\\.0\\.0\\.1|localhost)(:|/)'; then
                    echo "ERROR: DATABASE_URL points to localhost — production must use remote MySQL."
                    exit 1
                  fi
                else
                  echo "ERROR: DATABASE_URL missing from deploy .env"
                  exit 1
                fi

                if ! grep -q '^AUTH_SECRET=' "${DEST_ENV}"; then
                  echo "ERROR: AUTH_SECRET missing from deploy .env"
                  exit 1
                fi

                chown "$(id -un):$(id -gn)" "${DEST_ENV}" 2>/dev/null || \
                  sudo chown "$(id -un):$(id -gn)" "${DEST_ENV}"
                chmod 600 "${DEST_ENV}"
                echo "Deploy .env keys: $(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "${DEST_ENV}" || echo 0)"
                '''
            }
        }

        stage('Start containers') {
            steps {
                sh '''#!/bin/bash
                set -e
                DEST_ENV="${BACKEND_BASE}/${SLUG}/.env"

                set +x
                set -a
                # shellcheck disable=SC1091
                . "${DEST_ENV}"
                set +a

                if [ -z "${DATABASE_URL:-}" ] || [ -z "${AUTH_SECRET:-}" ]; then
                  echo "ERROR: DATABASE_URL / AUTH_SECRET missing after sourcing ${DEST_ENV}"
                  exit 1
                fi

                docker_cmd() {
                  if docker info >/dev/null 2>&1; then
                    docker "$@"
                  elif sudo -n docker info >/dev/null 2>&1; then
                    sudo -n docker "$@"
                  else
                    echo "ERROR: docker unavailable on this agent" >&2
                    return 1
                  fi
                }

                (cd "${WORKSPACE}" && docker_cmd compose -f docker-compose.yml down --remove-orphans) 2>/dev/null || true
                docker_cmd rm -f workflow-app >/dev/null 2>&1 || true

                mkdir -p "${WORKFLOW_UPLOADS_DIR}" 2>/dev/null || true
                sudo mkdir -p "${WORKFLOW_UPLOADS_DIR}" 2>/dev/null || true
                sudo chown -R "$(id -un):$(id -gn)" "${WORKFLOW_UPLOADS_DIR}" 2>/dev/null || true

                COMPOSE_ENV_FILE="$(mktemp)"
                cat > "${COMPOSE_ENV_FILE}" <<COMPOSEEOF
WORKFLOW_IMAGE_TAG=${BUILD_NUMBER}
WORKFLOW_ENV_FILE=${DEST_ENV}
WORKFLOW_UPLOADS_DIR=${WORKFLOW_UPLOADS_DIR}
COMPOSE_PROJECT_NAME=workflow
COMPOSEEOF

                cd "${WORKSPACE}"
                docker_cmd compose --env-file "${COMPOSE_ENV_FILE}" -f docker-compose.yml up -d --no-build --force-recreate
                docker_cmd compose --env-file "${COMPOSE_ENV_FILE}" -f docker-compose.yml ps
                rm -f "${COMPOSE_ENV_FILE}"

                echo "Waiting for app on port ${APP_PORT}..."
                sleep 8
                ready=0
                for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
                  if curl -fsS -o /dev/null "http://127.0.0.1:${APP_PORT}/auth/login"; then
                    ready=1
                    break
                  fi
                  if curl -fsS -o /dev/null "http://127.0.0.1:${APP_PORT}/"; then
                    ready=1
                    break
                  fi
                  sleep 3
                done
                if [ "${ready}" -ne 1 ]; then
                  echo "ERROR: App did not become healthy on port ${APP_PORT}"
                  docker_cmd logs --tail 80 workflow-app || true
                  exit 1
                fi
                curl -fsS -o /dev/null -w "app HTTP %{http_code}\\n" "http://127.0.0.1:${APP_PORT}/auth/login" || \
                  curl -fsS -o /dev/null -w "app HTTP %{http_code}\\n" "http://127.0.0.1:${APP_PORT}/"
                '''
            }
        }

        stage('Verify deployment') {
            steps {
                sh '''
                set -e

                echo "=== Docker containers ==="
                if docker info >/dev/null 2>&1; then
                  docker ps --filter name=workflow- --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}' || true
                elif sudo -n docker info >/dev/null 2>&1; then
                  sudo -n docker ps --filter name=workflow- --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}' || true
                fi

                echo "=== App (direct loopback) ==="
                curl -fsS -o /dev/null -w "app :${APP_PORT}/auth/login HTTP %{http_code}\\n" "http://127.0.0.1:${APP_PORT}/auth/login" || \
                  curl -fsS -o /dev/null -w "app :${APP_PORT}/ HTTP %{http_code}\\n" "http://127.0.0.1:${APP_PORT}/"

                echo "=== Via host nginx (${DOMAIN}) ==="
                curl -fsS -H "Host: ${DOMAIN}" "http://127.0.0.1/" -o /dev/null -w "nginx frontend HTTP %{http_code}\\n" || true

                echo "=== Via host nginx (${BACKEND_DOMAIN}) ==="
                curl -fsS -H "Host: ${BACKEND_DOMAIN}" "http://127.0.0.1/" -o /dev/null -w "nginx api HTTP %{http_code}\\n" || true
                '''
            }
        }
    }

    post {
        success {
            echo "Deployed workflow-app:${env.BUILD_NUMBER} → https://${env.DOMAIN} (loopback :${env.APP_PORT})"
        }
        failure {
            echo "Deploy failed. Check docker logs: docker logs --tail 100 workflow-app"
        }
    }
}
