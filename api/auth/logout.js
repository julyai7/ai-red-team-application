// POST /api/auth/logout -> signs this browser out ("Not you? Start over").
import { route } from '../_lib/http.js';
import { endSession } from '../_lib/session.js';

export default route({
  async POST(req, res) {
    await endSession(req, res);
    return { ok: true };
  },
});
