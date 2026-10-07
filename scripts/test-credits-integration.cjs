const fs=require('fs');const path=require('path');const assert=require('node:assert/strict');
const testUrl=process.env.CREDITS_TEST_DATABASE_URL;
if(!testUrl)throw new Error('Defina CREDITS_TEST_DATABASE_URL para um banco isolado.');
const parsed=new URL(testUrl);
if(!['localhost','127.0.0.1'].includes(parsed.hostname)||!/^\/credits_[a-z0-9_]+$/.test(parsed.pathname))throw new Error('O teste exige banco credits_* em loopback.');
process.env.DIRECT_URL=testUrl;process.env.JWT_SECRET=require('crypto').randomBytes(32).toString('hex');
require('tsconfig-paths').register({baseUrl:path.resolve('dist'),paths:{'src/*':['src/*']}});
require('reflect-metadata');
const {Test}=require('@nestjs/testing');const {ValidationPipe}=require('@nestjs/common');
const {PrismaClient}=require('@prisma/client');const {PrismaPg}=require('@prisma/adapter-pg');
const {AppModule}=require('../dist/src/app.module');const {PrismaService}=require('../dist/src/database/prisma.service');
const {ProjectCreditsImporter}=require('../dist/src/project-credits/importer/project-credits.importer');
const bcrypt=require('bcrypt');
async function main(){
 const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:testUrl})});await prisma.$connect();
 const suffix=Date.now().toString();const secretary=await prisma.secretary.create({data:{name:'Secretaria Teste Integração',email:`secretaria.${suffix}@cps.sp.gov.br`,password:await bcrypt.hash('Local-Test-2026!',10),birthDate:new Date('1990-01-01'),dueDate:new Date('2027-12-31'),lastLogin:new Date()}});
 const student=await prisma.student.create({data:{ra:`test-${suffix}`,name:'Aluno Teste Integração',email:`aluno.${suffix}@aluno.cps.sp.gov.br`,password:await bcrypt.hash('Local-Test-2026!',10),course:'DSM',status:'ATIVO',admission:'2026-01-01',dueDate:new Date('2027-12-31'),lastLogin:new Date()}});
 let app;const ids=[];
 try{
  const mod=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue(prisma).compile();
  app=mod.createNestApplication({logger:['error']});app.useGlobalPipes(new ValidationPipe());app.enableCors({origin:/^http:\/\/localhost:\d+$/,credentials:true});await app.listen(0,'127.0.0.1');
  const base=`http://127.0.0.1:${app.getHttpServer().address().port}`;
  let token;
  async function http(method,route,body,authenticated=true){const response=await fetch(base+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(authenticated&&token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();return {status:response.status,data};}
  const login=await http('POST','/autenticacao/login-secretaria',{email:secretary.email,password:'Local-Test-2026!'},false);assert.equal(login.status,200);token=login.data.token;assert.ok(token);
  assert.equal((await http('GET','/project-credits/admin/contributors',null,false)).status,401);
  const importer=new ProjectCreditsImporter(prisma);const imported=await importer.importCuratedCredits(false);const repeated=await importer.importCuratedCredits(false);assert.equal(repeated.created,0);
  const initial=await http('GET','/project-credits',null,false);assert.equal(initial.status,200);assert.ok(initial.data.contributors.some(c=>c.id==='wellingtonspdev'));assert.ok(initial.data.contributors.every(c=>c.photoUrl===null));
  const created=await http('POST','/project-credits/admin/contributors',{name:'Integração CRUD Teste',profileConfirmed:false});assert.equal(created.status,201);let record=created.data;ids.push(record.id);
  const payload={expectedVersion:record.draftVersion,name:'Integração CRUD Teste',profileConfirmed:true,participations:[{semester:'2026.2',course:'DSM',roles:['Desenvolvimento'],confirmed:true},{semester:'2027.1',course:'DSM',roles:['Testes'],confirmed:true}],links:[{kind:'EXTERNAL',label:'Blog',url:'https://example.org/blog?q=teste#creditos',confirmed:true}]};
  const edited=await http('PATCH',`/project-credits/admin/contributors/${record.id}`,payload);assert.equal(edited.status,200);record=edited.data;assert.equal(record.links[0].url,payload.links[0].url);
  assert.ok(!(await http('GET','/project-credits',null,false)).data.contributors.some(c=>c.id===record.id));
  const list=await http('GET','/project-credits/admin/contributors?q=Integra%C3%A7%C3%A3o%20CRUD');assert.equal(list.status,200);assert.ok(Array.isArray(list.data.items));assert.ok(list.data.items.some(c=>c.id===record.id));assert.ok(Array.isArray(list.data.items[0].roles));
  const published=await http('POST',`/project-credits/admin/contributors/${record.id}/publish`,{expectedVersion:record.draftVersion,profileConfirmed:true});assert.equal(published.status,201);record=published.data;
  const pub=(await http('GET','/project-credits',null,false)).data.contributors.find(c=>c.id===record.id);assert.equal(pub.contacts[0].href,payload.links[0].url);assert.equal(pub.participations.length,2);
  const drafts=await Promise.all(['Versão A','Versão B'].map(name=>http('PATCH',`/project-credits/admin/contributors/${record.id}`,{expectedVersion:record.draftVersion,name})));assert.deepEqual(drafts.map(r=>r.status).sort(),[200,409]);
  record=(await http('GET',`/project-credits/admin/contributors/${record.id}`)).data;
  assert.equal((await http('GET','/project-credits',null,false)).data.contributors.find(c=>c.id===record.id).name,pub.name);
  const historical=await http('GET',`/project-credits/admin/contributors/${record.id}/history`);assert.ok(Array.isArray(historical.data.items));assert.ok(historical.data.items.length>=3);
  assert.equal((await http('POST',`/project-credits/admin/contributors/${record.id}/photo`,{})).status,503);
  assert.equal((await http('PUT',`/project-credits/admin/contributors/${record.id}`,{expectedVersion:record.draftVersion,name:'Versão PUT'})).status,200);
  record=(await http('GET',`/project-credits/admin/contributors/${record.id}`)).data;
  assert.equal((await http('POST',`/project-credits/admin/contributors/${record.id}/archive`,{expectedVersion:record.draftVersion,reason:'Teste local'})).status,201);
  record=(await http('GET',`/project-credits/admin/contributors/${record.id}`)).data;
  assert.equal((await http('POST',`/project-credits/admin/contributors/${record.id}/restore`,{expectedVersion:record.draftVersion})).status,201);
  assert.ok(!(await http('GET','/project-credits',null,false)).data.contributors.some(c=>c.id===record.id));
  const studentLogin=await http('POST','/autenticacao/login',{email:student.email,password:'Local-Test-2026!'},false);assert.equal(studentLogin.status,200);const secretToken=token;token=studentLogin.data.token;assert.equal((await http('GET','/project-credits/admin/contributors')).status,403);token=secretToken;
  assert.equal((await http('PUT',`/secretaria/atualizar/${secretary.id}`,{name:'Tentativa'},false)).status,401);
  console.log(JSON.stringify({result:'PASS',database:parsed.pathname.slice(1),imported:imported.created,checks:['login real','JWT e papel','lista e busca','PATCH e PUT','publicação e rascunho','contatos e semestres','concorrência PostgreSQL','auditoria','arquivar/restaurar','fotos indisponíveis','proteção de Secretaria']}));
  if(process.env.CREDITS_KEEP_SERVER==='1'){
   fs.mkdirSync('.tmp',{recursive:true});fs.writeFileSync('.tmp/credits-integration-runtime.json',JSON.stringify({base,secretaryEmail:secretary.email,studentEmail:student.email,password:'Local-Test-2026!'}));
   console.log('Servidor de integração local mantido para testes de navegador.');await new Promise(()=>{});
  }
 }finally{if(app)await app.close();await prisma.projectContributor.deleteMany({where:{id:{in:ids}}});await prisma.student.delete({where:{ra:student.ra}});await prisma.secretary.delete({where:{id:secretary.id}});await prisma.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
