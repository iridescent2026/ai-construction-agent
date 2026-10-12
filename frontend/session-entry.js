// This is an entry screen, not a substitute for server authorization.
try {const s=JSON.parse(sessionStorage.getItem('factory-session')||'null');
 if(window.parent===window&&(!s?.token||s.expiresAt*1000<=Date.now()))location.replace('login.html?next='+encodeURIComponent(location.pathname+location.search+location.hash));
} catch {location.replace('login.html');}
