# The "editor" container: a small Apache that serves the scenario editor under /editor/.
#
# The image holds no code. The editor is built by the "app" container (Vite, from ./apps/editor
# mounted there) into the "editor-dist" volume, which docker-compose.yml mounts here as
# htdocs/editor. So the editor people get is the one in the checkout, with no image to rebuild.
#
# It holds no data and no secrets. Everything the editor does goes through the Laravel API in the
# "app" container, which checks who is asking; Apache puts both behind the same address.
# Built by Compose from this folder (context: docker/editor).
FROM httpd:2.4-alpine
COPY editor.conf conf/extra/editor.conf
RUN echo 'Include conf/extra/editor.conf' >> conf/httpd.conf \
    && rm -f htdocs/index.html && mkdir -p htdocs/editor
EXPOSE 80
# While "app" is still building the editor (the first minute after a start) there is no page yet.
HEALTHCHECK --interval=15s --timeout=3s --start-period=120s CMD wget -qO- http://127.0.0.1/editor/ > /dev/null || exit 1
