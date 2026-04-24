export async function invokeJsonHandler(handler, reqLike) {
  const responseState = {
    statusCode: 200,
    headers: {},
    body: "",
    sent: false,
  };

  const resLike = {
    setHeader(name, value) {
      responseState.headers[name] = value;
      return this;
    },
    status(code) {
      responseState.statusCode = code;
      return this;
    },
    json(payload) {
      if (!responseState.headers["Content-Type"]) {
        responseState.headers["Content-Type"] = "application/json; charset=utf-8";
      }

      responseState.body = JSON.stringify(payload);
      responseState.sent = true;
      return this;
    },
  };

  await handler(reqLike, resLike);

  if (!responseState.sent) {
    responseState.headers["Content-Type"] =
      responseState.headers["Content-Type"] || "application/json; charset=utf-8";
    responseState.body = responseState.body || JSON.stringify({});
  }

  return responseState;
}
