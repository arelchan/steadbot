# crew-server: the bots' home on a machine that stays on. Node for the server, Python and a few CLIs for skills.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git ripgrep curl ca-certificates tar unzip pandoc fonts-noto-cjk fonts-noto-color-emoji \
      # each bot's own computer (desktop.ts): an X display that is a VNC server, a window manager, a taskbar
      tigervnc-standalone-server openbox tint2 x11-xserver-utils dbus-x11 \
      # …and what makes it look and work like one: wallpaper, a file manager, a terminal, icons, screenshots
      feh pcmanfm lxterminal adwaita-icon-theme imagemagick \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --no-cache-dir --break-system-packages openpyxl python-docx python-pptx pypdf pandas matplotlib
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
# The browser the bots drive on their desktops (Playwright's Chromium + its system libraries). It goes to a fixed
# path, not ~/.cache: each bot's browser runs with HOME set to its own computer directory (desktop.ts).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update && npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
COPY . .
# The skill library is pulled from GitHub here, not shipped from the user's computer (see remote-install). A machine
# that cannot reach GitHub still gets a working server, just without the bundled library.
# The library ships with the code (machine.ts uploads it), because pulling it from GitHub here fails or half-fails
# on machines with poor GitHub access. Only sync when nothing came with the image.
RUN if [ -n "$(find library -name SKILL.md 2>/dev/null | head -1)" ]; then \
      echo "[crew] skill library shipped with the code: $(find library -name SKILL.md | wc -l) skills"; \
    else \
      npm run library:sync || echo "[crew] library sync failed; starting without the bundled skill library"; \
    fi
# Which commit this image was built from: the image has no .git, so the installer passes it in (version.ts).
ARG CREW_COMMIT=
RUN printf '%s' "$CREW_COMMIT" > /app/.build-commit
ENV CREW_HOME=/data CREW_PORT=5200 CREW_BIND=0.0.0.0 NODE_ENV=production
VOLUME ["/data"]
EXPOSE 5200
CMD ["sh", "scripts/run.sh"]
