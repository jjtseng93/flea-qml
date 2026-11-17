import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../ui/js/SettingsAbout.js',import.meta.url),'utf8').replace(/^\.pragma.*$/m,'');
const about=new Function(code+';return {packageFacts,rows}')();
test('About describes the installed flea-qml package and its own project links',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 const facts=about.packageFacts(JSON.stringify(pkg));
 expect(facts.version).toBe(pkg.version);
 expect(facts.author).toBe(pkg.author);
 expect(facts.repository).toBe('https://github.com/jjtseng93/flea-qml');
 const rows=about.rows({about:facts});
 expect(rows.find(r=>r.label==='Version').value).toBe(pkg.version);
 expect(rows.find(r=>r.id==='reportIssue').url).toBe(pkg.bugs.url);
 expect(rows.some(r=>r.id==='updateFlea'||r.id==='makeDefault'||r.id==='updates.autoCheck')).toBe(false);
});
test('metadata accepts npm author objects and rejects executable project URLs',()=>{
 const facts=about.packageFacts(JSON.stringify({author:{name:'Author'},bugs:'javascript:alert(1)',homepage:'file:///private',repository:'git+https://example.com/repo.git'}));
 expect(facts.author).toBe('Author');expect(facts.issues).toBe('');expect(facts.homepage).toBe('');
 expect(facts.repository).toBe('https://example.com/repo');
 expect(()=>about.packageFacts('[]')).toThrow();
 expect(about.rows({about:{error:'read failed'}}).some(r=>r.label==='read failed')).toBe(true);
});
