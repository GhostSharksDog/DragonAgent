// Local protocol fixture only. Replays bundled artwork; it does not perform AI inference.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const { WebSocketServer } = require(require.resolve('ws', { paths: [process.cwd(), path.resolve('node_modules/.pnpm/node_modules')] }));
export async function comfyFixture() {
  const atlas = path.resolve('assets/skins/silver-dragon-frames/idle-atlas.png'), meta = await sharp(atlas).metadata();
  const frames=[];
  for(let i=0;i<24;i++)frames.push(await sharp(atlas).extract({left:i%6*(meta.width/6),top:Math.floor(i/6)*(meta.height/4),width:meta.width/6,height:meta.height/4}).resize(460,460).extend({top:26,bottom:26,left:26,right:26,background:'#00000000'}).png().toBuffer());
  const images=new Map(),jobs=new Map(),requests=[],queueDeletes=[];
  const controls={loseNext:false,holdNext:false,opaqueMatte:false,invalidJson:false,invalidPng:false,brokenSubmit:false,brokenHistory:false,missingModel:false,missingNode:false,oomNext:false,externalPending:false,interrupts:0,webSockets:0};
  const spec=(required={},optional={})=>({input:{required,optional}}),str=(def='')=>['STRING',{default:def}],num=(def)=>['INT',{default:def}];
  const catalog={
    LoadImage:spec({image:str()}),SaveImage:spec({images:['IMAGE'],filename_prefix:str('ComfyUI')}),ImageBatch:spec({image1:['IMAGE'],image2:['IMAGE']}),
    CLIPTextEncode:spec({clip:['CLIP'],text:str()}),CheckpointLoaderSimple:spec({ckpt_name:[['animagine-xl-4.0.safetensors']]}),
    EmptyLatentImage:spec({width:num(1024),height:num(1024),batch_size:num(1)}),
    UNETLoader:spec({unet_name:[['wan2.2_ti2v_5B_fp16.safetensors']],weight_dtype:[['default']]}),
    CLIPLoader:spec({clip_name:[['umt5_xxl_fp8_e4m3fn_scaled.safetensors']],type:[['wan']],device:[['default']]}),
    VAELoader:spec({vae_name:[['wan2.2_vae.safetensors']]}),ModelSamplingSD3:spec({model:['MODEL'],shift:num(8)}),
    Wan22ImageToVideoLatent:spec({vae:['VAE'],width:num(512),height:num(512),length:num(49),batch_size:num(1)},{start_image:['IMAGE']}),
    VAEDecodeTiled:spec({samples:['LATENT'],vae:['VAE'],tile_size:num(512),overlap:num(64),temporal_size:num(16),temporal_overlap:num(4)}),
    KSampler:spec({model:['MODEL'],positive:['CONDITIONING'],negative:['CONDITIONING'],latent_image:['LATENT'],seed:num(1),steps:num(30),cfg:num(5),sampler_name:[['uni_pc','euler_ancestral']],scheduler:[['simple','normal']],denoise:num(1)}),
    BiRefNetRMBG:spec({image:['IMAGE'],model:[['BiRefNet_toonout']]},{sensitivity:num(1),mask_blur:num(0),mask_offset:num(0),invert_output:['BOOLEAN',{default:false}],refine_foreground:['BOOLEAN',{default:true}],unload_model:['BOOLEAN',{default:true}],background:[['Alpha','Color']],background_color:str('#222222')}),
  };
  const tuple=j=>[j.number,j.id,j.graph,{dragonagent:j.marker},['save']];
  const history=()=>Object.fromEntries([...jobs.values()].filter(j=>j.done).map(j=>[j.id,{prompt:tuple(j),status:{completed:true,status_str:j.oom?'error':'success',messages:j.oom?[['execution_error',{exception_message:'CUDA out of memory'}]]:[]},outputs:{save:{images:j.files}}}]));
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost'),route=url.pathname;
      const json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
      if(route==='/system_stats'){if(controls.invalidJson){res.end('{broken');return;}return json({system:{comfyui_version:'fixture-only',ram_total:16*1073741824,ram_free:6*1073741824},devices:[{name:'Simulated GPU — not real inference',type:'cuda',vram_total:8*1073741824,vram_free:6*1073741824}]});}
      if(route==='/object_info'){const result=structuredClone(catalog);if(controls.missingModel)result.UNETLoader.input.required.unet_name=[[]];if(controls.missingNode)delete result.BiRefNetRMBG;return json(result);}
      if(route==='/view'){const bytes=images.get(url.searchParams.get('filename'));if(!bytes){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':'image/png'});res.end(controls.invalidPng?Buffer.from('not a png'):bytes);return;}
      if(route.startsWith('/history')){if(controls.brokenHistory){res.end('{broken');return;}const all=history(),id=decodeURIComponent(route.slice('/history/'.length));return json(route==='/history'?all:all[id]?{[id]:all[id]}:{});}
      if(route==='/queue'&&req.method==='GET')return json({queue_running:[...jobs.values()].filter(j=>!j.done).map(tuple),queue_pending:controls.externalPending?[[999,'unrelated-task',{}, {},[]]]:[]});
      const parts=[];for await(const part of req)parts.push(part);const bytes=Buffer.concat(parts);
      if(route==='/upload/image'){
        const request=new Request('http://localhost/upload/image',{method:'POST',headers:req.headers,body:bytes}),form=await request.formData(),file=form.get('image');
        images.set(file.name,Buffer.from(await file.arrayBuffer()));return json({name:file.name,subfolder:'',type:'input'});
      }
      const body=bytes.length?JSON.parse(bytes):{};
      if(route==='/free')return json({});
      if(route==='/interrupt'){controls.interrupts++;return json({});}
      if(route==='/queue'){queueDeletes.push(...body.delete??[]);for(const id of body.delete??[])jobs.delete(id);return json({});}
      if(route==='/prompt'){
        const graph=body.prompt,nodes=Object.values(graph),kind=nodes.some(n=>n.class_type==='Wan22ImageToVideoLatent')?'video':nodes.some(n=>n.class_type==='BiRefNetRMBG')?'matte':'character';
        const id=randomUUID(),job={id,number:requests.length,graph,kind,marker:body.extra_data.dragonagent,clientId:body.client_id,done:!controls.holdNext,oom:controls.oomNext,files:[]};controls.holdNext=false;controls.oomNext=false;
        let outputs;
        if(kind==='video')outputs=Array.from({length:49},(_,i)=>frames[i%24]);
        else if(kind==='character')outputs=[frames[0]];
        else{outputs=nodes.filter(n=>n.class_type==='LoadImage').map(n=>images.get(n.inputs.image));if(controls.opaqueMatte)outputs=await Promise.all(outputs.map(b=>sharp(b).flatten({background:'#ffffff'}).ensureAlpha().png().toBuffer()));}
        for(let i=0;i<outputs.length;i++){const filename=`${id}-${String(i).padStart(3,'0')}.png`;images.set(filename,outputs[i]);job.files.push({filename,subfolder:'',type:'output'});}
        jobs.set(id,job);requests.push({id,kind,operationId:job.marker.operationId,graph});
        if(controls.loseNext){controls.loseNext=false;req.socket.destroy();return;}
        if(controls.brokenSubmit){controls.brokenSubmit=false;res.end('{broken');return;}
        return json({prompt_id:id,number:job.number});
      }
      res.writeHead(404);res.end();
    }catch(error){res.writeHead(500);res.end(String(error));}
  });
  const wss=new WebSocketServer({server});
  wss.on('connection',(socket,req)=>{
    controls.webSockets++;const clientId=new URL(req.url,'http://localhost').searchParams.get('clientId'),job=[...jobs.values()].find(j=>j.clientId===clientId);
    if(job){socket.send(JSON.stringify({type:'execution_start',data:{prompt_id:job.id}}));socket.send(JSON.stringify({type:'progress',data:{prompt_id:job.id,value:2,max:5}}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {endpoint:`http://127.0.0.1:${server.address().port}`,controls,jobs,requests,queueDeletes,frames,
    complete:()=>{for(const job of jobs.values())job.done=true;},
    close:async()=>{for(const client of wss.clients)client.terminate();await new Promise(resolve=>wss.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
  };
}
