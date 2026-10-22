// Source transfer: TUI2a04f075 scoped-native-archive.mjs, framing only; no native authority.
import { gzipSync, gunzipSync } from "node:zlib";
const LIMIT=256*1024*1024;
const deny=()=>{throw new Error("native archive denied");};
export function crc32(bytes) { let crc=0xffffffff; for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0; }
const octal=(bytes,start,length)=>{ const value=bytes.subarray(start,start+length).toString("ascii"); if(!/^[0-7]+\0$/u.test(value))deny();return parseInt(value.slice(0,-1),8); };
const text=(bytes,start,length)=>{const field=bytes.subarray(start,start+length);const end=field.indexOf(0);if(end<0||field.subarray(end).some(byte=>byte!==0))deny();return field.subarray(0,end).toString("ascii");};
function tar(binary) {
  const header=Buffer.alloc(512); header.write("service-lasso-tui");
  const put=(start,length,value)=>header.write(value.toString(8).padStart(length-1,"0")+"\0",start,length,"ascii");
  put(100,8,0o755);put(108,8,0);put(116,8,0);put(124,12,binary.length);put(136,12,0);
  header.fill(32,148,156);header[156]=48;header.write("ustar\0",257);header.write("00",263);
  const sum=header.reduce((a,b)=>a+b,0);header.write(sum.toString(8).padStart(6,"0")+"\0 ",148,8,"ascii");
  const compressed=gzipSync(Buffer.concat([header,binary,Buffer.alloc((512-binary.length%512)%512+1024)]),{mtime:0}); compressed[9]=3; return compressed;
}
function zip(binary) {
  const name=Buffer.from("service-lasso-tui.exe");const crc=crc32(binary);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(binary.length,18);local.writeUInt32LE(binary.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(binary.length,20);central.writeUInt32LE(binary.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+binary.length,16);
  return Buffer.concat([local,name,binary,central,name,end]);
}
export function createNativeArchive(platform,binary) {if(!Buffer.isBuffer(binary)||!binary.length||binary.length>LIMIT)deny();if(platform==="win32-amd64")return zip(binary);if(platform==="linux-amd64")return tar(binary);deny();}
export function verifyNativeArchive(platform,bytes) {
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>LIMIT+65536)deny();let binary;
  if(platform==="linux-amd64") {
    let body;try{body=gunzipSync(bytes,{maxOutputLength:LIMIT+2048});}catch{deny();}
    if(body.length<1536||body.length%512||text(body,0,100)!=="service-lasso-tui"||octal(body,100,8)!==0o755||octal(body,108,8)!==0||octal(body,116,8)!==0||octal(body,136,12)!==0||body[156]!==48||text(body,157,100)!==""||body.subarray(257,263).toString("ascii")!=="ustar\0"||body.subarray(263,265).toString("ascii")!=="00"||body.subarray(265,512).some(byte=>byte!==0))deny();
    const stored=body.subarray(148,156).toString("ascii");if(!/^[0-7]{6}\0 $/u.test(stored))deny();const header=Buffer.from(body.subarray(0,512));header.fill(32,148,156);if(header.reduce((a,b)=>a+b,0)!==parseInt(stored.slice(0,6),8))deny();
    const size=octal(body,124,12);if(size<=0||size>LIMIT||body.length!==512+Math.ceil(size/512)*512+1024||body.subarray(512+size).some(byte=>byte!==0))deny();binary=body.subarray(512,512+size);
  } else if(platform==="win32-amd64") {
    if(bytes.length<98)deny();const end=bytes.length-22;
    if(bytes.readUInt32LE(end)!==0x06054b50||bytes.readUInt16LE(end+4)!==0||bytes.readUInt16LE(end+6)!==0||bytes.readUInt16LE(end+8)!==1||bytes.readUInt16LE(end+10)!==1||bytes.readUInt16LE(end+20)!==0)deny();
    const central=bytes.readUInt32LE(end+16);const name=Buffer.from("service-lasso-tui.exe");const size=bytes.readUInt32LE(18);
    if(size<=0||size>LIMIT||central!==30+name.length+size||end!==central+46+name.length||bytes.readUInt32LE(end+12)!==46+name.length)deny();
    if(bytes.readUInt32LE(0)!==0x04034b50||bytes.readUInt16LE(4)!==20||bytes.readUInt16LE(6)!==0||bytes.readUInt16LE(8)!==0||bytes.readUInt16LE(10)!==0||bytes.readUInt16LE(12)!==33||bytes.readUInt32LE(22)!==size||bytes.readUInt16LE(26)!==name.length||bytes.readUInt16LE(28)!==0||!bytes.subarray(30,30+name.length).equals(name))deny();
    if(bytes.readUInt32LE(central)!==0x02014b50||bytes.readUInt16LE(central+4)!==20||bytes.readUInt16LE(central+6)!==20||bytes.readUInt16LE(central+8)!==0||bytes.readUInt16LE(central+10)!==0||bytes.readUInt16LE(central+12)!==0||bytes.readUInt16LE(central+14)!==33||bytes.readUInt32LE(central+20)!==size||bytes.readUInt32LE(central+24)!==size||bytes.readUInt16LE(central+28)!==name.length||bytes.subarray(central+30,central+46).some(byte=>byte!==0)||!bytes.subarray(central+46,end).equals(name))deny();
    binary=bytes.subarray(30+name.length,central);const crc=crc32(binary);if(bytes.readUInt32LE(14)!==crc||bytes.readUInt32LE(central+16)!==crc)deny();
  } else deny();
  // Reconstruct canonical producer bytes; compressed streams with trailing or
  // concatenated members and all unsupported framing/modes are rejected.
  if(platform==="linux-amd64") { if(binary.length<64||binary.subarray(0,4).toString("hex")!=="7f454c46"||binary[4]!==2||binary[5]!==1||binary.readUInt16LE(18)!==62)deny(); }
  else {if(binary.length<64||binary.subarray(0,2).toString("ascii")!=="MZ")deny();const pe=binary.readUInt32LE(60);if(pe<64||pe+26>binary.length||binary.readUInt32LE(pe)!==0x00004550||binary.readUInt16LE(pe+4)!==0x8664||binary.readUInt16LE(pe+24)!==0x20b)deny();}
  if(!createNativeArchive(platform,binary).equals(bytes))deny();return binary;
}
