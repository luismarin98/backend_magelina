import i18next from 'i18next';
import { AsyncLocalStorage } from 'node:async_hooks';
import { english } from './resources.js';
export function language(value?: string | null): 'es' | 'en' { return value?.toLowerCase().split('-')[0] === 'en' ? 'en' : 'es'; }
const context = new AsyncLocalStorage<'es' | 'en'>();
export const i18n = i18next.createInstance();
void i18n.init({ lng:'es',fallbackLng:'es',supportedLngs:['es','en'],initAsync:false,
  resources:{ en:{translation:{...english,'team.summary':'Team summary\nOverdue reviews: {{pending}}\nUnassigned follow-ups: {{unassigned}}\nCheck the dashboard for context. These counts do not establish confirmed violations.','panel.link':'Open your server in Magelina: {{url}}\nThe dashboard will check your permissions when you sign in.'}},es:{translation:{...Object.fromEntries(Object.keys(english).map(key=>[key,key])),'team.summary':'Resumen del equipo\nRevisiones pendientes: {{pending}}\nSeguimientos sin responsable: {{unassigned}}\nConsulta la dashboard para revisar el contexto. Estos recuentos no implican infracciones confirmadas.','panel.link':'Abre tu servidor en Magelina: {{url}}\nEl dashboard comprobara tus permisos al iniciar sesion.'}} },
  keySeparator:false,nsSeparator:false,interpolation:{escapeValue:false},
});
export function withLanguage<T>(locale: string | null | undefined, run:()=>T): T { return context.run(language(locale),run); }
export function t(key: string, values: Record<string,unknown> = {}): string { return String(i18n.t(key,{...values,lng:context.getStore() ?? 'es',defaultValue:key})); }
