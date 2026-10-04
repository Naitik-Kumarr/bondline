import fs from 'node:fs';
for (const name of ['judge-live', 'market-live', 'judge-local-3000', 'judge-local-3110', 'market-local-3000', 'market-local-3110', 'home-local-3000', 'home-local-3110']) {
  const file = `audit/evidence/${name}${name.startsWith('judge-local')?'.http':'.html'}`;
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  const text = html.replace(/<script[\s\S]*?<\/script\s*>/g,'').replace(/<style[\s\S]*?<\/style\s*>/g,'').replace(/<[^>]*>/g,' ').replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&amp;/g,'&').replace(/\s+/g,' ');
  fs.writeFileSync(`audit/evidence/${name}.txt`, text+'\n');
  console.log(JSON.stringify({name,length:html.length,bondline:html.includes('Bondline'),httpStatus:html.match(/^HTTP[^\r\n]*/)?.[0],urls:[...html.matchAll(/rel="canonical"[^>]*href="([^"]*)"/g)].map(x=>x[1])}));
}
