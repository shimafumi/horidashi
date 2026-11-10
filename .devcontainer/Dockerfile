FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

# clasp をグローバルにインストール（バージョンを固定したい場合は build args で指定）
ARG CLASP_VERSION=latest
RUN npm install -g @google/clasp@${CLASP_VERSION}

USER node

# clasp の認証情報をボリューム側に保存し、コンテナを作り直してもログイン状態が残るようにする。
# clasp 3.x はシンボリックリンクの認証ファイルを拒否するため、環境変数で保存先を直接指定する。
RUN mkdir -p /home/node/.config/clasp
ENV clasp_config_auth=/home/node/.config/clasp/.clasprc.json
