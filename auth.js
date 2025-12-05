// frontend/js/auth.js  (paste this exactly)
(function(){
  // role-aware token helpers
  function saveTokenForRole(role, token) {
    if (!role) role = 'customer';
    try {
      localStorage.setItem(`authToken_${role}`, token);
      // keep a generic fallback if none exists
      if (!localStorage.getItem('authToken')) localStorage.setItem('authToken', token);
    } catch (e) { console.warn('saveTokenForRole failed', e); }
  }

  function getTokenForRole(role) {
    if (!role) role = 'customer';
    return localStorage.getItem(`authToken_${role}`) || localStorage.getItem('authToken') || null;
  }

  function removeTokenForRole(role) {
    if (!role) role = 'customer';
    try { localStorage.removeItem(`authToken_${role}`); } catch(e){/*ignore*/ }
  }

  // Backwards-compatible shims used by existing pages
  function saveToken(token) { saveTokenForRole('customer', token); }
  function getToken() { return getTokenForRole('customer'); }
  function removeToken() { removeTokenForRole('customer'); }

  // export to window
  if (typeof window !== 'undefined') {
    window.saveTokenForRole = saveTokenForRole;
    window.getTokenForRole = getTokenForRole;
    window.removeTokenForRole = removeTokenForRole;
    window.saveToken = saveToken;
    window.getToken = getToken;
    window.removeToken = removeToken;
  }
})();
