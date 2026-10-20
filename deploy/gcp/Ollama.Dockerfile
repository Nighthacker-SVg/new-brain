# Official Ollama multi-platform manifest, resolved 2026-10-20.
# Pin the manifest, including the current OLLAMA_NO_CLOUD implementation.
FROM ollama/ollama@sha256:265409e1d931028a8f7d5a32bcbafddd7bffbc6cc629d77efe9560adf692a5e7
RUN mkdir -p /models && chown 10001:10001 /models
ENV HOME=/tmp OLLAMA_MODELS=/models
USER 10001:10001
