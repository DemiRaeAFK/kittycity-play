// Kitty City relay check (Demi, 22 and 24 Nov: friends on different networks never see each other).
// Two GitHub runners on different machines and networks open the LIVE website, check its relay list, ask each relay for an address,
// then meet in a test room through the game's own room code (window.claude.use('room')): first with only relayed paths allowed,
// then the normal way. Nothing here is a kid's room or save; bug counts are switched off and blocked.
const { chromium } = require('playwright-core');
const SITE = process.env.SITE || 'https://demiraeafk.github.io/kittycity-play/';
const WHO = process.env.WHO || 'A', OTHER = WHO === 'A' ? 'B' : 'A', RUN = process.env.RUN || String(Date.now());
const CHROME = process.env.CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; return c; };
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext();
  await ctx.route(/ntfy\.sh/, r => r.abort());
  await ctx.addInitScript(() => {
    try { localStorage.setItem('kc-pt-off', '1'); } catch (e) {}
    const O = window.RTCPeerConnection; window.__O = O; window.__pcs = []; window.__force = false;
    const P = function (c, ...a) { c = Object.assign({}, c || {}); if (window.__force) c.iceTransportPolicy = 'relay'; const p = new O(c, ...a); window.__pcs.push(p); return p; };
    P.prototype = O.prototype; Object.setPrototypeOf(P, O); window.RTCPeerConnection = P;
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('page error:', e.message));
  await page.goto(SITE + '?relaycheck=' + RUN, { waitUntil: 'load', timeout: 120000 });
  let signed = true;
  try { await page.waitForFunction(() => window.__NET_OPTS && __NET_OPTS.config && __NET_OPTS.config.iceServers.some(s => s.username && /:kittycity$/.test(s.username)), null, { timeout: 60000 }); } catch (e) { signed = false; }
  const ice = await page.evaluate(() => (window.__NET_OPTS && __NET_OPTS.config && __NET_OPTS.config.iceServers) || []);
  console.log('live relay list:', JSON.stringify(ice.map(s => ({ urls: s.urls, username: s.username }))));
  ok(signed, 'the live website signs its own Open Relay login');
  const extra = JSON.parse(process.env.EXTRA_ICE || '[]');
  const probe = await page.evaluate(async ([ice, extra]) => {
    const O = window.__O;
    const one = (server, policy, label) => new Promise(res => {
      const pc = new O({ iceServers: [server], iceTransportPolicy: policy }), out = { label, url: [].concat(server.urls).join(' '), cands: [], errors: [] };
      pc.onicecandidate = e => { if (e.candidate && e.candidate.candidate) { const f = e.candidate.candidate.split(' '); out.cands.push(f[7] + ' ' + f[2] + ' ' + f[4] + ':' + f[5]); } };
      pc.onicecandidateerror = e => out.errors.push(e.errorCode + ' ' + e.errorText + ' ' + (e.url || ''));
      pc.createDataChannel('x'); pc.createOffer().then(o => pc.setLocalDescription(o));
      setTimeout(() => { pc.close(); res(out); }, 9000);
    });
    const t = [one({ urls: 'stun:stun.l.google.com:19302' }, 'all', 'google stun')];
    for (const s of ice) if (s.username) for (const u of [].concat(s.urls)) t.push(one({ urls: u, username: s.username, credential: s.credential }, 'relay', 'live'));
    t.push(one({ urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }, 'relay', 'old login'));
    t.push(one({ urls: 'turn:eu-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' }, 'relay', 'old peerjs'));
    for (const s of extra) for (const u of [].concat(s.urls)) t.push(one({ urls: u, username: s.username, credential: s.credential }, 'relay', s.label || 'extra'));
    return Promise.all(t);
  }, [ice, extra]);
  for (const p of probe) console.log('probe', p.label, '|', p.url, '| candidates:', JSON.stringify(p.cands), '| errors:', JSON.stringify(p.errors.slice(0, 4)));
  const pub = (probe[0].cands.find(c => /^srflx/.test(c)) || '').split(' ')[2];
  console.log('this runner is at', pub || '(no public address found)', 'on', process.platform);
  ok(probe.filter(p => p.label === 'live').some(p => p.cands.some(c => /^relay/.test(c))), 'the live relay hands out a relayed address');
  for (const mode of (process.env.MODES || 'relay,normal').split(',')) {
    const res = await page.evaluate(async ([WHO, OTHER, name, force]) => {
      window.__force = force; const n0 = window.__pcs.length;
      const lobby = await window.claude.use('room'), t = await lobby.join(name);
      let seen = null, mine = 0; const t0 = Date.now();
      t.onPeers(({ peers }) => { const o = peers.find(p => !p.isMe && p.presence && p.presence.who === OTHER); if (o) seen = o.presence; });
      const send = () => t.presence({ who: WHO, n: mine });
      await send();
      while (Date.now() - t0 < 300000 && !(seen && seen.n >= 3 && mine >= 3)) { await new Promise(r => setTimeout(r, 1000)); if (seen && mine < 3) { mine++; await send(); } }
      const met = !!seen, waited = Math.round((Date.now() - t0) / 1000);
      await new Promise(r => setTimeout(r, 12000));   // stay a moment so the other runner sees my last update too
      const pairs = [];
      for (const pc of window.__pcs.slice(n0)) {
        if (pc.connectionState !== 'connected') continue;
        const st = await pc.getStats(); let pair = null; const by = {};
        st.forEach(r => { by[r.id] = r; if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) pair = r; });
        if (pair) { const l = by[pair.localCandidateId] || {}, r = by[pair.remoteCandidateId] || {}; pairs.push(l.candidateType + '/' + (l.relayProtocol || l.protocol) + ' <-> ' + r.candidateType + '/' + r.protocol); }
      }
      t.leave();
      return { met, got: seen && seen.n, waited, pairs, state: t.state && t.state() };
    }, [WHO, OTHER, 'relaytest-' + RUN + '-' + mode, mode === 'relay']);
    console.log(mode, 'room:', JSON.stringify(res));
    ok(res.met && res.got >= 3, (mode === 'relay' ? 'through the relay only' : 'the normal way') + ', ' + WHO + ' meets ' + OTHER + ' and sees its updates (' + res.waited + ' s)');
  }
  await b.close();
  console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exitCode = fails ? 1 : 0;
})().catch(e => { console.log('FAILED', e.stack || e); process.exitCode = 1; });
