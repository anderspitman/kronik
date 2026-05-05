FROM debian:13

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates tmux curl xz-utils git ripgrep python3 python3-dev \
        python3-venv build-essential mingw-w64 libglfw3-dev libglew-dev \
        libgl1-mesa-dev \
        && rm -rf /var/lib/apt/lists/*

WORKDIR /root

ARG NODE_VERSION=24.15.0
RUN curl -O https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz \
        && tar xf node-v${NODE_VERSION}-linux-x64.tar.xz \
        && mv node-v${NODE_VERSION}-linux-x64 node \
        && rm node-v${NODE_VERSION}-linux-x64.tar.xz

ENV PATH="/root/node/bin:${PATH}"
RUN echo 'PATH="$HOME/node/bin:${PATH}"' >> .profile

#RUN npm install -g @openai/codex
RUN npm install -g @mariozechner/pi-coding-agent
