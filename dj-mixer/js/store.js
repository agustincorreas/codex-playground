const P = 'mixr.';
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch { /* quota */ } },
  del(k) { try { localStorage.removeItem(P + k); } catch { /* ignore */ } },
};
