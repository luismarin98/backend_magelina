import test from 'node:test';
import assert from 'node:assert/strict';
import { language,withLanguage,t } from '../src/i18n/index.js';
const key='Reproductor actualizado. Consulta /musica cola o el dashboard.';
test('locale selection supports English variants and Spanish fallback',()=>{
 assert.equal(language('en-US'),'en');assert.equal(language('es-419'),'es');assert.equal(language('de'),'es');
 assert.equal(t(key),key);assert.equal(withLanguage('en-US',()=>t(key)),'Player updated. Check /musica cola or the dashboard.');
});
test('concurrent interactions cannot change each others language',async()=>{
 const [english,spanish]=await Promise.all([
  withLanguage('en-GB',async()=>{await new Promise(resolve=>setTimeout(resolve,20));return t(key);}),
  withLanguage('es',async()=>{await new Promise(resolve=>setTimeout(resolve,5));return t(key);}),
 ]);
 assert.equal(english,'Player updated. Check /musica cola or the dashboard.');assert.equal(spanish,key);
});
test('untranslated user content remains intact and dynamic values are interpolated',()=>{
 assert.equal(withLanguage('en',()=>t('Texto aportado por un miembro')),'Texto aportado por un miembro');
 const result=withLanguage('en',()=>t('panel.link',{url:'https://example.com/dashboard'}));
 assert.ok(result.startsWith('Open your server'));assert.ok(result.includes('https://example.com/dashboard'));
});

test('shared summaries use the selected server language and only interpolate counts',()=>{
 const result=withLanguage('en-GB',()=>t('team.summary',{pending:2,unassigned:1}));
 assert.ok(result.includes('Overdue reviews: 2'));assert.ok(result.includes('Unassigned follow-ups: 1'));
 assert.ok(!result.includes('{{'));
 assert.ok(withLanguage('es',()=>t('team.summary',{pending:0,unassigned:0})).startsWith('Resumen del equipo'));
});
