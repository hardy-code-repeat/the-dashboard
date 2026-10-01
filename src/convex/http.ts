import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { googleCallback } from "./calendar";

const http = httpRouter();

auth.addHttpRoutes(http);

// The OAuth redirect target. It has to be an HTTP route — a provider sends the
// user's browser here, and there is no other way to receive that. The handler
// authenticates nothing itself; it authenticates by redeeming a state that is
// already bound to the user who started the flow.
http.route({ path: "/oauth/google-calendar/callback", method: "POST", handler: googleCallback });
http.route({ path: "/oauth/google-calendar/callback", method: "GET", handler: googleCallback });

export default http;
