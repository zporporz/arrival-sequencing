// Local-only visual fixture. Does not read credentials or call production APIs.
// node scripts/preview-regional.mjs, then http://127.0.0.1:5187/?regional=VTCC
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync(new URL('../functions/_data/regional-arrivals.json', import.meta.url), 'utf8'));
const server = await createServer({ server: { host: '127.0.0.1', port: 5187, strictPort: true }, plugins: [{
  name: 'local-regional-fixture',
  configureServer(vite) {
    // This fixture never joins production rooms.
    vite.httpServer?.on('upgrade', (req, socket) => { if (req.url?.startsWith('/api/sequence/realtime')) socket.destroy(); });
    vite.middlewares.use((req, res, next) => {
      const url = new URL(req.url, 'http://127.0.0.1:5187');
      if (!url.pathname.startsWith('/api/')) return next();
      const requested = url.searchParams.get('airport');
      const code = requested === 'VTSP' ? 'VTSP' : 'VTCC';
      let payload;
      if (url.pathname === '/api/auth/me') payload = { authenticated: true, user: { id: 'local-test', vid: 'LOCAL', name: 'Local fixture', isThailandStaff: false, staffPositions: [], createdAt: new Date().toISOString() } };
      else if (url.pathname === '/api/sequence/regional-navdata') payload = { cycle: data.cycle, source: data.source, airport: data.airports[code] };
      else if (url.pathname === '/api/sequence/aircraft-performance') payload = { type: 'A320', found: true, profile: { source: 'SIMBRIEF', aircraftType: 'A320', aircraftName: 'Local test fixture', performanceCategory: 'C', descentProfile: '78/280/250 (TEST)', descentMach: .78, descentIasKt: 280, descentBelow10000IasKt: 250 } };
      else if (url.pathname === '/api/sequence/aman-state') payload = { workspaces: [], flightStates: [], sequenceOrders: [] };
      else if (url.pathname === '/api/sequence/operational-config') payload = { workspaces: [], timings: [] };
      else if (url.pathname === '/api/sequence/landed-history') payload = { flights: [], history: [] };
      else if (url.pathname === '/api/sequence/ivao-traffic' && !['VTCC', 'VTSP'].includes(requested)) payload = { airport: requested, fetchedAt: new Date().toISOString(), flights: [] };
      else if (url.pathname === '/api/sequence/ivao-traffic') {
        const star = data.airports[code].procedures.find(p => p.kind === 'STAR' && p.runway === (code === 'VTSP' ? '27' : '18'));
        const [a, b] = star.legs;
        const bearing = (Math.atan2((b.lon-a.lon)*Math.cos(a.lat*Math.PI/180),b.lat-a.lat)*180/Math.PI+360)%360;
        payload = { airport: code, fetchedAt: new Date().toISOString(), flights: [
          { sessionId: 'LOCAL-ONLY', callsign: 'TEST320', arrival: code, departure: 'VTBD', route: star.name, aircraft: 'A320', state: 'En Route', onGround: false, latitude: (a.lat+b.lat)/2, longitude: (a.lon+b.lon)/2, altitude: 13000, groundSpeed: 280, heading: bearing, trackTimestamp: new Date().toISOString() },
          { sessionId: 'LOCAL-GROUND', callsign: 'TEST-GROUND', arrival: code, departure: 'VTBD', route: star.name, aircraft: 'A320', state: 'Boarding', onGround: true, latitude: 13.9, longitude: 100.6 },
        ] };
      } else if (url.pathname === '/api/sequence/route-geometry') payload = { origin: '', destination: '', segments: [], errors: [] };
      else { res.statusCode = 404; payload = { error: 'Local fixture endpoint only' }; }
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(payload));
    });
  },
}] });
await server.listen();
server.printUrls();
