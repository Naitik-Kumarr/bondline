const fs = require('node:fs');
const ignore = require('../../node_modules/ignore');
const paths = ['.env','.env.local','.env.production.local','.env.example',
  '_private/audit-placeholder.md','logs/audit-placeholder.log','web/.env.local',
  'web/_private/audit-placeholder.md','web/logs/audit-placeholder.log'];
const result = {gitRepositoryPresent: fs.existsSync('.git'), results: []};
for (const file of ['.gitignore','.vercelignore']) {
  const rules = ignore().add(fs.readFileSync(file,'utf8'));
  result.results.push({file, paths: paths.map(path=>({path,ignored:rules.ignores(path)}))});
}
console.log(JSON.stringify(result,null,2));
