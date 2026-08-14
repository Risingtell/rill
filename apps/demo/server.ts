/**
 * Entry point for the demo resource server. The app itself lives in app.ts and binds
 * nothing, so tests and serverless hosts can import it without a listener starting as
 * a side effect of the import. This file is the only place that opens a port.
 */

import app, { ensureStream } from "./app.js";

const port = parseInt(process.env.PORT || "8403", 10);
void ensureStream().catch(() => {});
app.listen(port, () => console.log(`[demo] listening on :${port}`));
