import fs from 'node:fs';
import {keccak256} from 'viem';
const snap=JSON.parse(fs.readFileSync('audit/evidence/deployment-snapshot.json','utf8'));
const normalizeRefs=r=>Object.values(r||{}).flat().map(x=>({start:x.start,length:x.length})).sort((a,b)=>a.start-b.start);
const rows=snap.contracts.map(row=>{
  const file=`audit/contracts/out/${row.type}.sol/${row.type}.json`;
  const fresh=JSON.parse(fs.readFileSync(file,'utf8'));
  const old=JSON.parse(fs.readFileSync(row.artifact,'utf8'));
  return {role:row.role,type:row.type,freshArtifact:file,freshRuntimeHash:keccak256(fresh.deployedBytecode.object),snapshotArtifactRuntimeHash:row.artifactRuntimeHash,freshRuntimeMatchesSnapshotArtifact:keccak256(fresh.deployedBytecode.object)===row.artifactRuntimeHash,creationBytecodeEqualsOriginal:fresh.bytecode.object===old.bytecode.object,immutableOffsetRangesEqual:JSON.stringify(normalizeRefs(fresh.deployedBytecode.immutableReferences))===JSON.stringify(normalizeRefs(old.deployedBytecode.immutableReferences)),metadataSettings:fresh.metadata.settings};
});
fs.writeFileSync('audit/evidence/fresh-build-compare.json',JSON.stringify({command:'node audit/evidence/fresh-build-compare.mjs',queriedAt:new Date().toISOString(),rows},null,2)+'\n');
console.log(rows.map(({role,freshRuntimeMatchesSnapshotArtifact,creationBytecodeEqualsOriginal,immutableOffsetRangesEqual})=>({role,freshRuntimeMatchesSnapshotArtifact,creationBytecodeEqualsOriginal,immutableOffsetRangesEqual})));
