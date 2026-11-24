/**
 * api.js — session handling and the single function that talks to the Apps Script backend.
 *
 * Why text/plain? A POST with Content-Type "text/plain" is a CORS "simple request": the browser sends it
 * without a pre-flight OPTIONS request (Apps Script web apps cannot answer OPTIONS). The JSON is sent as a
 * string in the body and the backend parses it itself. fetch() follows Apps Script's redirect automatically.
 */
(function () {
  var GD = window.GD = window.GD || {};
  var TOKEN_KEY = 'gd_token', USER_KEY = 'gd_user';

  GD.session = {
    token: function () { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } },
    user: function () { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; } },
    set: function (token, user) { try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch (e) { /* storage blocked */ } },
    setUser: function (user) { try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch (e) { /* ignore */ } },
    setToken: function (token) { try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* ignore */ } },
    clear: function () { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch (e) { /* ignore */ } }
  };

  GD.newId = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  };

  function apiError(code, message, extra) {
    var e = new Error(message);
    e.code = code;
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }

  var SIGNED_OUT_CODES = { UNAUTHORIZED: 1, ACCOUNT_DISABLED: 1, GUEST_DISABLED: 1 };

  GD.api = {
    configured: function () {
      var u = (window.GD_CONFIG && GD_CONFIG.API_URL) || '';
      return /^https:\/\/script\.google(usercontent)?\.com\/.+/.test(u);
    },

    /**
     * call('startNote', {...}, {requestId, timeoutMs, noAuth})
     * Resolves with the `data` of an ok response. Rejects with Error{code,message,network}.
     */
    call: function (action, data, opts) {
      opts = opts || {};
      if (!GD.api.configured()) {
        return Promise.reject(apiError('NOT_CONFIGURED', 'The backend is not connected yet. The administrator must paste the Apps Script Web App URL into js/config.js.'));
      }
      if (!navigator.onLine) {
        return Promise.reject(apiError('OFFLINE', 'You are offline. This feature needs an internet connection.', { network: true }));
      }
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || GD_CONFIG.REQUEST_TIMEOUT_MS || 300000);
      var body = JSON.stringify({
        action: action,
        token: opts.noAuth ? '' : GD.session.token(),
        requestId: opts.requestId || '',
        data: data || {}
      });
      return fetch(GD_CONFIG.API_URL, {
        method: 'POST', redirect: 'follow', credentials: 'omit', signal: ctrl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body
      }).then(function (res) {
        return res.text();
      }).then(function (text) {
        clearTimeout(timer);
        var json;
        try { json = JSON.parse(text); } catch (e) {
          throw apiError('BAD_RESPONSE', 'The backend did not return valid data. Check that the Apps Script Web App is deployed with "Execute as: Me" and "Who has access: Anyone", and that js/config.js uses the /exec URL.', { network: true });
        }
        if (!json.ok) {
          var er = json.error || {};
          if (SIGNED_OUT_CODES[er.code] && !opts.noAuth) {
            GD.session.clear();
            document.dispatchEvent(new CustomEvent('gd:signedout', { detail: er.code }));
          }
          throw apiError(er.code || 'ERROR', er.message || 'Something went wrong.');
        }
        return json.data;
      }, function (err) {
        clearTimeout(timer);
        if (err && err.name === 'AbortError') throw apiError('TIMEOUT', 'The server took too long to respond. Your work may still have been saved — please check and try again.', { network: true });
        throw apiError('NETWORK', 'Could not reach the server. Check your internet connection and that the Web App URL in js/config.js is correct.', { network: true });
      });
    }
  };
})();
