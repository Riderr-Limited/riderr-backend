// services/whatsapp/invoke.js
// Runs an existing route's middleware/controller chain in-process, the same
// way Express would, so the WhatsApp bot reuses the app's business logic
// (fares, driver matching, payments, refunds, notifications) instead of
// duplicating it.

/**
 * @param {Function[]} handlers  middleware + controller, in route order
 * @param {object} ctx           { user, app, body, params, query }
 * @returns {Promise<{ status: number, ok: boolean, body: any }>}
 */
export async function runRoute(handlers, { user, app, body = {}, params = {}, query = {} } = {}) {
  let result = null;

  const req = {
    user,
    app,
    body,
    params,
    query,
    headers: {},
    method: "POST",
    originalUrl: "whatsapp://internal",
    ip: "whatsapp",
    get: () => undefined,
    header: () => undefined,
  };

  const res = {
    statusCode: 200,
    locals: {},
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      if (!result) result = { status: this.statusCode, body: payload };
      this.headersSent = true;
      return this;
    },
    send(payload) {
      return this.json(payload);
    },
    end() {
      return this.json(null);
    },
    set() {
      return this;
    },
    setHeader() {
      return this;
    },
  };

  const wrap = ({ status, body: payload }) => ({
    status,
    body: payload,
    ok: status < 400 && payload?.success !== false,
  });

  try {
    for (const handler of handlers) {
      let nextCalled = false;
      let nextError;

      await handler(req, res, (err) => {
        nextCalled = true;
        nextError = err;
      });

      if (result) return wrap(result);
      if (nextError) {
        return wrap({ status: nextError.statusCode || 500, body: { success: false, message: nextError.message } });
      }
      if (!nextCalled) {
        return wrap({ status: 500, body: { success: false, message: "Handler finished without responding" } });
      }
    }
    return wrap({ status: 500, body: { success: false, message: "No handler responded" } });
  } catch (error) {
    console.error(" WhatsApp runRoute error:", error);
    return wrap({ status: 500, body: { success: false, message: error.message } });
  }
}
