// Minimal Worker entry. Forwards all requests to static assets.
// Add /api/... routes here when you need server-side logic + KV/D1/etc.

export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
