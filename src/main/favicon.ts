import {lookup} from 'node:dns/promises';
import https from 'node:https';
import {nativeImage} from 'electron';
import {publicAddress} from './web-read';
const cache=new Map<string,{time:number;image:Uint8Array|null}>();
export async function siteIcon(host:string):Promise<Uint8Array|null> {
  if(!/^[a-z0-9.-]{1,253}$/i.test(host))return null;
  const prior=cache.get(host);if(prior&&Date.now()-prior.time<300000)return prior.image;
  let image:Uint8Array|null=null;
  try {
    const addresses=await lookup(host,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))return null;
    const ip=addresses[0];
    const data=await new Promise<Buffer>((resolve,reject)=>{
      const request=https.get({hostname:host,path:'/favicon.ico',family:ip.family,lookup:(_host,_options,done)=>done(null,ip.address,ip.family),signal:AbortSignal.timeout(4000),headers:{Accept:'image/*','User-Agent':'DragonAgent/0.4'}},response=>{
        if(response.statusCode!==200){response.resume();reject(Error('No icon'));return;}
        const parts:Buffer[]=[];let size=0;response.on('data',(data:Buffer)=>{size+=data.length;if(size>131072){response.destroy();reject(Error('Icon too large'));}else parts.push(data);});response.on('end',()=>resolve(Buffer.concat(parts)));response.on('error',reject);
      });request.on('error',reject);
    });
    const icon=nativeImage.createFromBuffer(data);if(!icon.isEmpty())image=new Uint8Array(icon.resize({width:24,height:24}).toPNG());
  }catch{/* Missing or blocked icons use the local globe. */}
  cache.set(host,{time:Date.now(),image});if(cache.size>128)cache.delete(cache.keys().next().value!);return image;
}
