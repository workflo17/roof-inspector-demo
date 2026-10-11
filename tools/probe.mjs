// Run one JavaScript expression in the app at phone size and print the result.
// Usage: node tools/probe.mjs <hash route or "ID/..."> "<expression>" [width] [baseUrl]
//   "#/"  is the list; "#/i/@/a/front" uses @ for the sample inspection's id.
// Used to find out WHY a layout check failed, for example which element makes a page scroll sideways.
import { launchChrome, until, sleep } from './cdp.mjs';

const [route = '#/', expr = 'document.title', width = '390', base = 'http://127.0.0.1:5290/'] = process.argv.slice(2);
const c = await launchChrome();
try {
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: Number(width), height: 844, deviceScaleFactor: 2, mobile: true });
  await c.send('Page.navigate', { url: base });
  await until(() => c.evalJS(`document.readyState === 'complete' && !!document.querySelector('#view h1')`));
  const id = await c.evalJS(`document.querySelector('.card').getAttribute('href').split('/')[2]`);
  const target = route.replace('@', id);
  await c.evalJS(`location.hash = ${JSON.stringify(target)}`);
  await sleep(500);
  console.error(`route asked for: ${route}  id found: ${id}  hash now: ${await c.evalJS('location.hash')}`);
  console.log(JSON.stringify(await c.evalJS(expr), null, 2));
} catch (e) {
  console.log('probe failed:', e.message);
} finally {
  await c.close();
}
