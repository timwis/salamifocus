# PowerSync with this repository's configuration and sync rules baked in, so
# a deploy pulls rules that match the app server image built from the same
# commit. Keep the version in step with compose.yaml.
FROM journeyapps/powersync-service:1.28.3
COPY service.yaml sync-config.yaml /config/
ENV POWERSYNC_CONFIG_PATH=/config/service.yaml
CMD ["start", "-r", "unified"]
