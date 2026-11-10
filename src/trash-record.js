// Metadata follows real file operations, never the original (restoration) path.
import {lstatSync,readFileSync,unlinkSync,writeFileSync,renameSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {homeTrash,knownTrashes,trashInfoOriginal,trashInfoPath} from './trash.js';
const identity=st=>`${st.dev}:${st.ino}:${st.mode}:${st.birthtimeMs}`;
export function trashRecord(path) {
  const files=dirname(resolve(path)),root=dirname(files);
  if(basename(files)!=='files')return null;
  const known=[homeTrash(),...knownTrashes()].map(resolvePath=>resolve(resolvePath));
  if(!known.includes(root) && !/^\.Trash-\d+$/.test(basename(root)) && basename(dirname(root))!=='.Trash')return null;
  try {
    for(const dir of [root,files,join(root,'info')]) {
      const st=lstatSync(dir);
      if(!st.isDirectory() || (process.getuid && (st.uid!==process.getuid() || (st.mode&0o077))))return null;
    }
    const info=join(root,'info',basename(path)+'.trashinfo'),st=lstatSync(info);
    if(!st.isFile()||st.size>1024*1024)return null;
    return {path:resolve(path),info,text:readFileSync(info,'utf8'),identity:identity(st),root};
  }catch{return null}
}
export function forgetTrashRecord(record) {
  if(!record)return;
  try {lstatSync(record.path);return} catch(e){if(e.code!=='ENOENT')return}
  try {
    if(identity(lstatSync(record.info))===record.identity && readFileSync(record.info,'utf8')===record.text)unlinkSync(record.info);
  }catch(e){if(e.code!=='ENOENT')throw e}
}
// Reserve the new metadata name before moving; refuse collisions rather than overwrite.
export function renameWithTrashRecord(source,destination) {
  try {lstatSync(destination);throw Error('An item with that name already exists')}catch(e){if(e.code!=='ENOENT')throw e}
  const record=trashRecord(source);
  if(!record){renameSync(source,destination);return}
  if(dirname(resolve(destination))!==dirname(record.path))throw Error('Rename must stay in the same directory');
  const top=record.root===resolve(homeTrash())?'':basename(dirname(record.root))==='.Trash'?dirname(dirname(record.root)):dirname(record.root);
  const original=trashInfoOriginal((/^Path=(.*)$/m.exec(record.text)?.[1]??'').trim(),top);
  const text=original?record.text.replace(/^Path=.*$/m,()=> 'Path='+trashInfoPath(join(dirname(original),basename(destination)),top)):record.text;
  const info=join(record.root,'info',basename(destination)+'.trashinfo');
  writeFileSync(info,text,{flag:'wx',mode:0o600});
  try {renameSync(source,destination)}catch(e){unlinkSync(info);throw e}
  forgetTrashRecord(record);
}
