import { ConfigError } from './env.js';

export type StartupStage = 'configuration' | 'mongodb' | 'indexes' | 'discord' | 'http';
const labels: Record<StartupStage, string> = { configuration: 'configuracion', mongodb: 'conexion MongoDB', indexes: 'indices MongoDB', discord: 'conexion Discord', http: 'API HTTP' };
const hints: Record<StartupStage, string> = {
  configuration: 'Revisa las variables del archivo .env.',
  mongodb: 'Comprueba que MongoDB este disponible, las credenciales y el acceso de red.',
  indexes: 'Comprueba los permisos para crear indices y posibles datos duplicados.',
  discord: 'Comprueba DISCORD_TOKEN y la conectividad con Discord.',
  http: 'Comprueba PORT y los permisos para abrir el servidor HTTP.',
};

/** No registra mensajes, stacks ni objetos de librerias que puedan incluir credenciales. */
export function startupErrorMessage(stage: StartupStage, cause: unknown): string {
  let detail = hints[stage];
  if (stage === 'configuration' && cause instanceof ConfigError) detail = cause.message;
  else if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    if (stage === 'http' && cause.code === 'EADDRINUSE') detail = 'El puerto configurado ya esta ocupado. Cierra el otro proceso o cambia PORT.';
    if (stage === 'http' && cause.code === 'EACCES') detail = 'El proceso no tiene permiso para abrir el puerto configurado.';
    if (stage === 'http' && cause.code === 'EADDRNOTAVAIL') detail = 'La interfaz de red solicitada no esta disponible para abrir el servidor HTTP.';
    if (stage === 'mongodb' && cause.code === 18) detail = 'MongoDB rechazo la autenticacion. Revisa las credenciales de MONGODB_URI.';
    if (stage === 'mongodb' && ['ENOTFOUND', 'EAI_AGAIN', 'ENODATA', 'ESERVFAIL'].includes(String(cause.code))) detail = 'No se pudo resolver el destino de MongoDB. Comprueba el hostname y la configuracion DNS.';
    if (stage === 'mongodb' && cause.code === 'ECONNREFUSED') detail = 'La conexion a MongoDB fue rechazada. Comprueba el destino, el puerto y el acceso de red.';
    if (stage === 'mongodb' && 'syscall' in cause && (cause.syscall === 'querySrv' || cause.syscall === 'queryTxt')) detail = `Fallo de resolucion DNS ${cause.syscall === 'querySrv' ? 'SRV' : 'TXT'} de MongoDB. Comprueba el hostname del cluster y que tu red permita estas consultas DNS.`;
    if (stage === 'indexes' && cause.code === 11000) detail = 'Hay datos duplicados que impiden crear un indice unico.';
    if (stage === 'discord' && (cause.code === 'TokenInvalid' || cause.code === 4004)) detail = 'Discord rechazo el token recibido por este proceso. Una variable DISCORD_TOKEN heredada del entorno tiene prioridad sobre el archivo .env; comprueba cual se esta usando.';
  }
  if (stage === 'discord' && typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 401) detail = 'Discord rechazo el token recibido por este proceso (HTTP 401). Comprueba si DISCORD_TOKEN del entorno esta sustituyendo al del archivo .env.';
  return `No se pudo iniciar el backend [${labels[stage]}]: ${detail}`;
}
