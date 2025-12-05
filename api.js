// frontend/js/api.js
const API_BASE_URL = "http://localhost:5000";

/**
 * apiRequest(path, method, body, requireAuth = false, role = 'customer')
 * - role: 'customer' | 'delivery_partner' | 'restaurant_owner' | 'admin'
 * - when requireAuth true, the function will look for role-specific token using getTokenForRole (exposed by auth.js)
 */
async function apiRequest(path, method = 'GET', body = null, requireAuth = false, role = 'customer') {
  const headers = { 'Content-Type': 'application/json' };

  if (requireAuth) {
    // prefer role-aware token getter, fallback to generic
    let token = null;
    try {
      if (typeof getTokenForRole === 'function') token = getTokenForRole(role);
    } catch (e) { /* ignore */ }
    if (!token) token = localStorage.getItem('authToken') || localStorage.getItem('token') || null;
    if (!token) throw new Error('No auth token (log in first)');
    headers['Authorization'] = 'Bearer ' + token;
  }

  const res = await fetch(API_BASE_URL + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    const err = new Error(data?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}
